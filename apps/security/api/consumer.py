# SPDX-License-Identifier: FSL-1.1-ALv2
"""NATS JetStream consumer for the detector service.

Subscribes to splyntra.detect subject and runs all detectors on incoming spans.
Results are published back to the collector or written directly to ClickHouse.
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal

import nats
from nats.aio.client import Client as NATS
from nats.js.api import ConsumerConfig, DeliverPolicy

from detectors.models import Detection
from detectors.pii import PIIDetector
from detectors.secrets import SecretDetector
from detectors.injection import InjectionDetector
from detectors.moderation import ModerationDetector
from detectors.tool_guard import DangerousToolCallDetector

logger = logging.getLogger(__name__)

MAX_RETRIES = 5  # Max redelivery attempts before dead-lettering


class DetectorConsumer:
    """Consumes spans from NATS and runs detection pipeline."""

    def __init__(self, nats_url: str = "nats://localhost:4222"):
        self.nats_url = nats_url
        self.nc: NATS | None = None
        # PII loads Presidio/spaCy at construction; if that fails (e.g. the model
        # isn't in this image), degrade to the other detectors instead of
        # crash-looping before NATS ever connects. The other detectors lazy-load
        # or are pure-regex, so they don't need this guard.
        try:
            self.pii: PIIDetector | None = PIIDetector()
        except Exception as e:  # noqa: BLE001 - degrade on any load failure
            logger.error("PII detector unavailable, continuing without it: %s", e)
            self.pii = None
        self.secrets = SecretDetector()
        self.injection = InjectionDetector()
        self.moderation = ModerationDetector()
        self.tool_guard = DangerousToolCallDetector()
        self._shutdown = asyncio.Event()

    async def start(self):
        """Connect to NATS and start consuming with reconnection support."""
        self.nc = await nats.connect(
            self.nats_url,
            reconnected_cb=self._on_reconnect,
            disconnected_cb=self._on_disconnect,
            error_cb=self._on_error,
            max_reconnect_attempts=60,
            reconnect_time_wait=2,
        )
        js = self.nc.jetstream()

        # Subscribe to the detection subject
        sub = await js.subscribe(
            "splyntra.detect",
            durable="detector-service",
            config=ConsumerConfig(
                # ALL (not NEW): when the durable is first created, scan the
                # existing backlog too. NEW starts at "now", silently skipping any
                # spans already in the stream before the detector came up — a
                # security pipeline must not leave a gap of unscanned spans.
                deliver_policy=DeliverPolicy.ALL,
                ack_wait=30,
                max_deliver=MAX_RETRIES,
            ),
        )

        logger.info("Detector consumer started, listening on splyntra.detect")

        # Process until shutdown signal
        while not self._shutdown.is_set():
            try:
                msg = await sub.next_msg(timeout=5)
            except (asyncio.TimeoutError, nats.errors.TimeoutError):
                continue
            except Exception as e:
                logger.error("Error receiving message: %s", e)
                await asyncio.sleep(1)
                continue

            try:
                await self._process_message(msg)
            except json.JSONDecodeError as e:
                logger.error("Invalid JSON in message, dead-lettering: %s", e)
                await msg.term()  # Permanently terminate (dead-letter)
                continue
            except KeyError as e:
                logger.error("Missing required field %s, dead-lettering", e)
                await msg.term()
                continue
            except Exception as e:
                logger.error("Failed to process message: %s", e)
                await msg.nak(delay=2)  # NAK with backoff
                continue

            # Ack AFTER successful processing, in its own try. A failed ack must
            # NOT fall through to nak — that would redeliver a message whose
            # detectors already ran and whose result already published, causing a
            # duplicate result (the collector dedups identical results, but we
            # avoid the needless republish here).
            try:
                await msg.ack()
            except Exception as e:
                logger.warning("Ack failed after successful processing: %s", e)

    async def _process_message(self, msg):
        """Process a single span message through all detectors."""
        data = json.loads(msg.data)

        trace_id = data["trace_id"]
        span_id = data["span_id"]
        agent_id = data.get("agent_id", "")
        span_type = data.get("type", "")
        tool_name = data.get("name", "")
        raw_input = data.get("raw_input", "")
        raw_output = data.get("raw_output", "")

        # Concatenate content for analysis
        content = f"{raw_input}\n{raw_output}".strip()
        if not content:
            return

        detections: list[Detection] = []

        # Run detectors in thread pool (CPU-bound). Moderation scans the model
        # OUTPUT; tool_guard inspects tool_call spans (name + args). PII is skipped
        # if its model failed to load (see __init__).
        loop = asyncio.get_event_loop()
        tasks = [
            loop.run_in_executor(None, self.secrets.scan, content),
            loop.run_in_executor(None, self.injection.scan, content),
            loop.run_in_executor(None, self.moderation.scan, raw_output or content),
            loop.run_in_executor(None, self.tool_guard.scan, span_type, tool_name, content),
        ]
        if self.pii is not None:
            tasks.append(loop.run_in_executor(None, self.pii.scan, content))
        for hits in await asyncio.gather(*tasks):
            detections.extend(hits)

        if detections:
            risk_score = self._compute_risk(detections)

            result = {
                "trace_id": trace_id,
                "span_id": span_id,
                "agent_id": agent_id,
                "org_id": data.get("org_id", ""),
                "project_id": data.get("project_id", ""),
                "risk_score": risk_score,
                "detections": [
                    {
                        "detector": d.detector,
                        "category": d.category,
                        "severity": d.severity,
                        "confidence": d.confidence,
                        "description": d.description,
                        "beta": d.beta,
                    }
                    for d in detections
                ],
            }

            # Publish detection results back
            if self.nc:
                await self.nc.jetstream().publish(
                    "splyntra.detections.result",
                    json.dumps(result).encode(),
                )

            logger.info(
                "Detections found: trace=%s span=%s count=%d risk=%d",
                trace_id, span_id, len(detections), risk_score,
            )

    def _compute_risk(self, detections: list[Detection]) -> int:
        severity_weights = {"CRITICAL": 40, "HIGH": 25, "MEDIUM": 10, "LOW": 5}
        score = 0
        for d in detections:
            weight = severity_weights.get(d.severity, 5)
            score += int(weight * d.confidence)
        return min(score, 100)

    async def stop(self):
        """Gracefully shutdown the consumer."""
        self._shutdown.set()
        if self.nc:
            await self.nc.drain()

    async def _on_reconnect(self):
        logger.info("NATS reconnected")

    async def _on_disconnect(self):
        logger.warning("NATS disconnected")

    async def _on_error(self, e):
        logger.error("NATS error: %s", e)


async def run_consumer(nats_url: str = "nats://localhost:4222"):
    """Entry point for running the detector consumer with graceful shutdown."""
    consumer = DetectorConsumer(nats_url)

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(consumer.stop()))

    await consumer.start()


if __name__ == "__main__":
    import os

    logging.basicConfig(level=logging.INFO)
    nats_url = os.environ.get("NATS_URL", "nats://localhost:4222")
    asyncio.run(run_consumer(nats_url))
