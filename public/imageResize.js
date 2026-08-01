const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.85;

// Pure geometry, split out so it is testable without a canvas.
function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const w = Math.max(1, Math.floor(Number(width) || 0));
  const h = Math.max(1, Math.floor(Number(height) || 0));
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

// createImageBitmap applies EXIF orientation, so portrait phone photos don't
// come out lying on their side. The <img> path is the fallback for browsers
// without it.
async function loadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => { if (bitmap.close) bitmap.close(); },
    };
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve({
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      release: () => URL.revokeObjectURL(url),
    });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_DECODE_FAILED')); };
    img.src = url;
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Always re-encodes to JPEG, even when the source already fits: one code path
// and one predictable output type beats a branch, and q0.85 on an
// already-small JPEG is not visible.
async function resizeImageFile(file, maxEdge = MAX_EDGE) {
  const image = await loadImageSource(file);
  const { width, height } = fitWithin(image.width, image.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  try {
    canvas.getContext('2d').drawImage(image.source, 0, 0, width, height);
  } finally {
    image.release();
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('IMAGE_ENCODE_FAILED');
  return { base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
}

export { fitWithin, resizeImageFile, MAX_EDGE };
