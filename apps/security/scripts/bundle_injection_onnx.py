# SPDX-License-Identifier: FSL-1.1-ALv2
"""Export the prompt-injection classifier to ONNX (and quantize) at build time.

Run in the Docker build so the security service ships an offline, CPU-fast
injection model — no HuggingFace download at first runtime call (which fails in
locked-down containers, silently degrading detection to regex-only).

Writes to ``SPLYNTRA_INJECTION_MODEL_DIR`` (default /app/models/injection-onnx),
which detectors/injection.py loads from first. Quantization is best-effort; if it
fails the fp32 ONNX export is still used.
"""

from __future__ import annotations

import os
import sys

MODEL_ID = "protectai/deberta-v3-base-prompt-injection-v2"
OUT_DIR = os.getenv("SPLYNTRA_INJECTION_MODEL_DIR", "/app/models/injection-onnx")


def main() -> int:
    os.makedirs(OUT_DIR, exist_ok=True)
    from optimum.onnxruntime import ORTModelForSequenceClassification
    from transformers import AutoTokenizer

    print(f"exporting {MODEL_ID} → ONNX at {OUT_DIR} …", flush=True)
    model = ORTModelForSequenceClassification.from_pretrained(MODEL_ID, export=True)
    model.save_pretrained(OUT_DIR)
    AutoTokenizer.from_pretrained(MODEL_ID).save_pretrained(OUT_DIR)

    # Best-effort dynamic int8 quantization — shrinks the image ~3-4x and speeds
    # CPU inference. Skipped (fp32 kept) if the op set can't be quantized.
    try:
        from optimum.onnxruntime import ORTQuantizer
        from optimum.onnxruntime.configuration import AutoQuantizationConfig

        quantizer = ORTQuantizer.from_pretrained(OUT_DIR)
        qconfig = AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False)
        quantizer.quantize(save_dir=OUT_DIR, quantization_config=qconfig)
        print("quantized ONNX model written (model_quantized.onnx)", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"quantization skipped ({e}); using fp32 ONNX", flush=True)

    print(f"bundled injection model → {OUT_DIR}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
