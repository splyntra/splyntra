// SPDX-License-Identifier: FSL-1.1-ALv2
// Client-side image downscale → capped data: URL. Avatars/logos are small and
// stored inline in Postgres (no object store), so we resize in the browser and
// hard-cap the result before it ever reaches the server.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // reject huge source files early
export const MAX_DATA_URL_BYTES = 512 * 1024; // hard cap on the stored string

/**
 * Downscale an image File to at most `max` px on its longest side and return a
 * data: URL (PNG, or JPEG if PNG exceeds the cap). Throws a user-friendly Error
 * for non-images, oversized files, or images that won't compress under the cap.
 */
export async function imageToDataUrl(file: File, max = 256): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Image is too large (5 MB max).");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that image."));
      el.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser can't process images here.");
    ctx.drawImage(img, 0, 0, w, h);

    let out = canvas.toDataURL("image/png");
    if (out.length > MAX_DATA_URL_BYTES) out = canvas.toDataURL("image/jpeg", 0.85);
    if (out.length > MAX_DATA_URL_BYTES) throw new Error("Image is too detailed — try a simpler one.");
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
