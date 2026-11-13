export interface PreparedImage {
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  fileName: string;
  fileSizeBytes: number;
}

const SUPPORTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const MAX_DIMENSION = 2200;

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read image file."));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image. Try PNG, JPEG, or WebP."));
    img.src = src;
  });
}

export async function prepareImageForOcr(file: File | Blob, fallbackName = "pasted-image.png"): Promise<PreparedImage> {
  const rawMime = (file.type || "image/png").toLowerCase();
  const normalizedMime = rawMime === "image/jpg" ? "image/jpeg" : rawMime;

  if (!SUPPORTED_TYPES.has(normalizedMime)) {
    throw new Error("Unsupported file type. Please choose a PNG, JPEG, WebP, or GIF image.");
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error("Image file is over 20 MB. Please choose a smaller image.");
  }

  const fileName = file instanceof File && file.name ? file.name : fallbackName;
  const rawDataUrl = await readBlobAsDataUrl(file);
  const img = await loadImageElement(rawDataUrl);

  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  // Preserve original data URL if dimensions and payload are already compact
  if (
    origWidth <= MAX_DIMENSION &&
    origHeight <= MAX_DIMENSION &&
    rawDataUrl.length < 4 * 1024 * 1024
  ) {
    return {
      dataUrl: rawDataUrl,
      mimeType: normalizedMime,
      width: origWidth,
      height: origHeight,
      fileName,
      fileSizeBytes: file.size,
    };
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(origWidth, origHeight));
  const targetWidth = Math.max(1, Math.round(origWidth * scale));
  const targetHeight = Math.max(1, Math.round(origHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      dataUrl: rawDataUrl,
      mimeType: normalizedMime,
      width: origWidth,
      height: origHeight,
      fileName,
      fileSizeBytes: file.size,
    };
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const outputMime = normalizedMime === "image/png" ? "image/png" : "image/jpeg";
  let optimizedDataUrl = canvas.toDataURL(outputMime, 0.9);
  let finalMime = outputMime;

  // If PNG is still large (e.g. photo saved as PNG), convert to high-quality JPEG
  if (optimizedDataUrl.length > 5 * 1024 * 1024 && outputMime === "image/png") {
    optimizedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
    finalMime = "image/jpeg";
  }

  return {
    dataUrl: optimizedDataUrl,
    mimeType: finalMime,
    width: targetWidth,
    height: targetHeight,
    fileName,
    fileSizeBytes: Math.round((optimizedDataUrl.length * 3) / 4),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
