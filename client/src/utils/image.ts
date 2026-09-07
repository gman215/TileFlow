/**
 * Preparing a photo for the room-from-image route.
 *
 * Two constraints shape this, and they are not the same constraint:
 *
 * 1. **Cost** (Constitution VII). A 4032×3024 phone photo costs far more to
 *    interpret than the 1600px version, and reads no better — a floor plan is
 *    line work, not detail.
 * 2. **The body cap.** Vercel rejects a function request body over 4.5 MB, and
 *    the image travels as base64, which is ~33% larger than the bytes it
 *    encodes. So the figure to measure is the *encoded* length, not the blob
 *    size — the retry ladder below checks the string it is about to send.
 *
 * Everything here runs before any network call, so an unreadable file costs
 * nothing (AC-1.4).
 */

/** Formats the route accepts. Anything else is refused before decoding. */
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export interface DownscaledImage {
  /** Bare base64 — no `data:` URI prefix, which the route's schema rejects. */
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/**
 * A file the user can do something about: wrong format, corrupt, or too big to
 * send even after every retry. Carries a message written for the panel, not a
 * stack trace.
 */
export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

/**
 * Progressively cheaper attempts, in order. Quality drops before resolution
 * does: a JPEG at q0.7 still reads a dimension label cleanly, while dropping to
 * 1200px starts to lose thin lines and small text.
 */
const LADDER: { maxEdge: number; quality: number }[] = [
  { maxEdge: 1600, quality: 0.85 },
  { maxEdge: 1600, quality: 0.7 },
  { maxEdge: 1200, quality: 0.7 },
];

function isAcceptedType(type: string): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

/** Longest-edge fit. Never upscales — a small sketch stays its own size. */
function fit(width: number, height: number, maxEdge: number): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

async function encode(bitmap: ImageBitmap, w: number, h: number, quality: number): Promise<Blob> {
  // A PNG plan is usually line work on transparency. JPEG has no alpha, so an
  // unpainted background composites to black and the drawing disappears into
  // it — hence the white fill before the draw.
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new ImageError('This browser could not process the image.');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('This browser could not process the image.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new ImageError('This browser could not process the image.')),
      'image/jpeg',
      quality
    );
  });
}

/** Blob → bare base64, via the data URI the reader already produces. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new ImageError('The image could not be read.'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Decode, downscale and JPEG-encode a user-selected image, small enough to send.
 *
 * @param maxBytes the cap on the **encoded** base64 length, matching what the
 *   route measures. Defaults to the route's own 4 MB body cap.
 * @throws {ImageError} for a file that is not an image, cannot be decoded
 *   (a HEIC this browser has no decoder for, a `.txt` renamed to `.jpg`), or is
 *   still too large after every step of the ladder.
 */
export async function downscaleToJpeg(
  file: File,
  maxEdge = 1600,
  quality = 0.85,
  maxBytes = 4_000_000
): Promise<DownscaledImage> {
  // A type the browser has already identified as something else never reaches a
  // decoder. An empty type (some HEIC files) is left to the decode attempt.
  if (file.type && !isAcceptedType(file.type)) {
    throw new ImageError('Choose a photo or screenshot of a plan — JPEG, PNG, WEBP or HEIC.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Covers a corrupt file, a mislabelled one, and HEIC on a browser with no
    // decoder for it — all the same thing to the user.
    throw new ImageError('That image could not be read. Try a JPEG or PNG screenshot of the plan.');
  }

  try {
    // The caller's arguments are the first rung, and only rungs *strictly*
    // cheaper than it follow — otherwise the default arguments, which are
    // LADDER[0], would encode the same image twice before making any progress.
    const steps = [
      { maxEdge, quality },
      ...LADDER.filter(
        (s) => s.maxEdge <= maxEdge && (s.maxEdge < maxEdge || s.quality < quality)
      ),
    ];

    let smallest: DownscaledImage | null = null;

    for (const step of steps) {
      const { w, h } = fit(bitmap.width, bitmap.height, step.maxEdge);
      const base64 = await toBase64(await encode(bitmap, w, h, step.quality));

      if (base64.length <= maxBytes) {
        return { base64, mimeType: 'image/jpeg', width: w, height: h };
      }
      if (!smallest || base64.length < smallest.base64.length) {
        smallest = { base64, mimeType: 'image/jpeg', width: w, height: h };
      }
    }

    throw new ImageError(
      `That image is too large to send even after resizing (${Math.round(
        (smallest?.base64.length ?? 0) / 1_000_000
      )} MB). Try a screenshot or a smaller photo.`
    );
  } finally {
    // Frees the decoded pixels immediately rather than at the next GC — a
    // 4032×3024 bitmap is ~48 MB.
    bitmap.close();
  }
}
