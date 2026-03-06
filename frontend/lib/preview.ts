/**
 * Preview file generata SOLO nel browser: decrypt lato client e object URL.
 * Il server non vede mai il contenuto in chiaro.
 */

import { decryptFileChunked, hexToBytes } from './crypto';

export async function decryptAndPreview(
  encryptedBlob: Blob,
  dekHex: string,
  mimeType: string,
  fileId?: string,
): Promise<string> {
  const encryptedBytes = new Uint8Array(await encryptedBlob.arrayBuffer());
  const dek = hexToBytes(dekHex);
  const plaintext = await decryptFileChunked(encryptedBytes, dek, fileId);
  const blob = new Blob([plaintext as BlobPart], { type: mimeType });
  return URL.createObjectURL(blob);
}

/** Genera thumbnail da Blob immagine (es. dopo decrypt). */
export async function generateThumbnail(decryptedBlob: Blob): Promise<string> {
  const img = document.createElement('img');
  img.src = URL.createObjectURL(decryptedBlob);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Image load failed'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2d not available');
  ctx.drawImage(img, 0, 0, 200, 200);
  URL.revokeObjectURL(img.src);
  return canvas.toDataURL('image/jpeg', 0.8);
}
