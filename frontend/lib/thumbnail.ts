/**
 * Generazione e cifratura thumbnail client-side (TASK 8.3).
 * Le thumbnail sono JPEG 200x200 cifrati con AES-GCM.
 * Non lasciano il browser in chiaro.
 */

import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  decryptFileChunked,
  encryptFileChunked,
  generateKey,
  hexToBytes,
} from '@/lib/crypto'

const THUMB_SIZE = 200
const THUMB_QUALITY = 0.75

export type ThumbnailResult = {
  encryptedBase64: string
  keyHex: string
  mimeType: 'image/jpeg'
  width: number
  height: number
}

/**
 * Genera thumbnail da File (immagine o PDF).
 * Restituisce null se il tipo non è supportato.
 */
export async function generateThumbnail(
  file: File
): Promise<ThumbnailResult | null> {
  const type = file.type.toLowerCase()
  if (type.startsWith('image/')) {
    return generateImageThumbnail(file)
  }
  if (type === 'application/pdf') {
    return generatePdfThumbnail(file)
  }
  return null
}

async function generateImageThumbnail(
  file: File
): Promise<ThumbnailResult | null> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = async () => {
      URL.revokeObjectURL(url)
      try {
        const jpeg = await renderToCanvas(
          img,
          img.naturalWidth,
          img.naturalHeight
        )
        const result = await encryptJpeg(jpeg)
        resolve(result)
      } catch (e) {
        reject(e)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

async function generatePdfThumbnail(file: File): Promise<ThumbnailResult | null> {
  try {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const scale = Math.min(
      THUMB_SIZE / viewport.width,
      THUMB_SIZE / viewport.height
    )

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width * scale)
    canvas.height = Math.round(viewport.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const viewportScaled = page.getViewport({ scale })
    await page.render({
      canvasContext: ctx,
      viewport: viewportScaled,
    }).promise

    const jpeg = await canvasToJpegBytes(canvas)
    return await encryptJpeg(jpeg)
  } catch {
    return null
  }
}

async function renderToCanvas(
  img: HTMLImageElement,
  w: number,
  h: number
): Promise<Uint8Array> {
  const scale = Math.min(THUMB_SIZE / w, THUMB_SIZE / h, 1)
  const tw = Math.round(w * scale)
  const th = Math.round(h * scale)
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2d context unavailable')
  ctx.drawImage(img, 0, 0, tw, th)
  return canvasToJpegBytes(canvas)
}

function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Canvas toBlob fallito'))
          return
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)))
      },
      'image/jpeg',
      THUMB_QUALITY
    )
  })
}

async function encryptJpeg(jpegBytes: Uint8Array): Promise<ThumbnailResult> {
  const key = await generateKey()
  const encrypted = await encryptFileChunked(jpegBytes, key, 'thumbnail')
  return {
    encryptedBase64: bytesToBase64(encrypted),
    keyHex: bytesToHex(key),
    mimeType: 'image/jpeg',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
  }
}

/**
 * Genera un data URL (JPEG) per anteprima da File (immagine o PDF), senza cifratura.
 * Usato per mostrare l'anteprima nelle card quando la thumbnail salvata non c'è ancora.
 */
export async function generateThumbnailPreviewUrl(
  file: File
): Promise<string | null> {
  const type = file.type?.toLowerCase() ?? ''
  if (type.startsWith('image/')) {
    return new Promise((resolve) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        try {
          const scale = Math.min(THUMB_SIZE / img.naturalWidth, THUMB_SIZE / img.naturalHeight, 1)
          const w = Math.round(img.naturalWidth * scale)
          const h = Math.round(img.naturalHeight * scale)
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(null)
            return
          }
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY))
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(null)
      }
      img.src = url
    })
  }
  if (type === 'application/pdf') {
    try {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const page = await pdf.getPage(1)
      const viewport = page.getViewport({ scale: 1 })
      const scale = Math.min(
        THUMB_SIZE / viewport.width,
        THUMB_SIZE / viewport.height
      )
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width * scale)
      canvas.height = Math.round(viewport.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const viewportScaled = page.getViewport({ scale })
      await page.render({
        canvasContext: ctx,
        viewport: viewportScaled,
      }).promise
      return canvas.toDataURL('image/jpeg', THUMB_QUALITY)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Decifra e crea un object URL per la thumbnail.
 * Ricordati di chiamare URL.revokeObjectURL() dopo l'uso.
 */
export async function decryptThumbnail(
  encryptedBase64: string,
  keyHex: string
): Promise<string> {
  const encrypted = base64ToBytes(encryptedBase64)
  const key = hexToBytes(keyHex)
  const decrypted = await decryptFileChunked(encrypted, key, 'thumbnail')
  const blob = new Blob([decrypted as BlobPart], { type: 'image/jpeg' })
  return URL.createObjectURL(blob)
}
