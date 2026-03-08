const ICONS_BASE = '/icons'

const FILE_ICON_MAP: Record<string, { src: string; label: string }> = {
  pdf:        { src: `${ICONS_BASE}/icon_pdf.svg`,  label: 'PDF' },
  pdf_signed: { src: `${ICONS_BASE}/icon_pdf.svg`,  label: 'PDF' },
  doc:        { src: `${ICONS_BASE}/icon_doc.svg`,  label: 'DOC' },
  docx:       { src: `${ICONS_BASE}/icon_docx.svg`, label: 'DOC' },
  xls:        { src: `${ICONS_BASE}/icon_xls.svg`,  label: 'XLS' },
  xlsx:       { src: `${ICONS_BASE}/icon_xlsx.svg`, label: 'XLS' },
  ppt:        { src: `${ICONS_BASE}/icon_ppt.svg`,  label: 'PPT' },
  pptx:       { src: `${ICONS_BASE}/icon_pptx.svg`, label: 'PPT' },
  mp4:        { src: `${ICONS_BASE}/icon_mp4.svg`,  label: 'VID' },
  mov:        { src: `${ICONS_BASE}/icon_mov.svg`,  label: 'VID' },
  avi:        { src: `${ICONS_BASE}/icon_avi.svg`,  label: 'VID' },
  mp3:        { src: `${ICONS_BASE}/icon_mp3.svg`,  label: 'AUDIO' },
  wav:        { src: `${ICONS_BASE}/icon_wav.svg`,  label: 'AUDIO' },
  ogg:        { src: `${ICONS_BASE}/icon_ogg.svg`,  label: 'AUDIO' },
  m4a:        { src: `${ICONS_BASE}/icon_mp3.svg`,  label: 'AUDIO' },
  png:        { src: `${ICONS_BASE}/icon_png.svg`,  label: 'IMG' },
  jpg:        { src: `${ICONS_BASE}/icon_jpg.svg`,  label: 'IMG' },
  jpeg:       { src: `${ICONS_BASE}/icon_jpeg.svg`, label: 'IMG' },
  gif:        { src: `${ICONS_BASE}/icon_gif.svg`,  label: 'IMG' },
  webp:       { src: `${ICONS_BASE}/icon_png.svg`,  label: 'IMG' },
  bmp:        { src: `${ICONS_BASE}/icon_bmp.svg`,  label: 'IMG' },
  tiff:       { src: `${ICONS_BASE}/icon_png.svg`,  label: 'IMG' },
  tif:        { src: `${ICONS_BASE}/icon_png.svg`,  label: 'IMG' },
  zip:        { src: `${ICONS_BASE}/icon_zip.svg`,  label: 'ZIP' },
  rar:        { src: `${ICONS_BASE}/icon_rar.svg`,  label: 'ZIP' },
  txt:        { src: `${ICONS_BASE}/icon_txt.svg`,  label: 'TXT' },
  csv:        { src: `${ICONS_BASE}/icon_csv.svg`,  label: 'CSV' },
  html:       { src: `${ICONS_BASE}/icon_html.svg`, label: 'HTML' },
  rtf:        { src: `${ICONS_BASE}/icon_rtf.svg`,  label: 'RTF' },
  psd:        { src: `${ICONS_BASE}/icon_psd.svg`,  label: 'PSD' },
}

const DEFAULT_FILE_ICON = { src: `${ICONS_BASE}/icon_file.svg`, label: 'FILE' }

const FOLDER_ICONS = [
  `${ICONS_BASE}/folder01.png`,
  `${ICONS_BASE}/folder02.png`,
  `${ICONS_BASE}/folder03.png`,
  `${ICONS_BASE}/folder04.png`,
  `${ICONS_BASE}/folder05.png`,
  `${ICONS_BASE}/folder06.png`,
] as const

const FOLDER_COLOR_MAP: Record<string, { normal: string; locked: string }> = {
  yellow: { normal: '/icons/folder_yellow.svg', locked: '/icons/folder_yellow_locked.svg' },
  blue:   { normal: '/icons/folder_blue.svg',   locked: '/icons/folder_blue_locked.svg' },
  green:  { normal: '/icons/folder_green.svg',  locked: '/icons/folder_green_locked.svg' },
  red:    { normal: '/icons/folder_red.svg',     locked: '/icons/folder_red_locked.svg' },
  purple: { normal: '/icons/folder_purple.svg', locked: '/icons/folder_purple_locked.svg' },
  orange: { normal: '/icons/folder_orange.svg', locked: '/icons/folder_orange_locked.svg' },
  teal:   { normal: '/icons/folder_teal.svg',   locked: '/icons/folder_teal_locked.svg' },
  pink:   { normal: '/icons/folder_pink.svg',   locked: '/icons/folder_pink_locked.svg' },
  indigo: { normal: '/icons/folder_indigo.svg', locked: '/icons/folder_indigo_locked.svg' },
  gray:   { normal: '/icons/folder_gray.svg',   locked: '/icons/folder_gray_locked.svg' },
}

/** Indice icona cartella (1-10) → colore per il menu contestuale */
export const FOLDER_ICON_OPTIONS: { index: number; color: string; label: string; colorKey: string }[] = [
  { index: 1,  color: '#F9A825', label: 'Giallo',  colorKey: 'yellow' },
  { index: 2,  color: '#546E7A', label: 'Grigio',  colorKey: 'gray'   },
  { index: 3,  color: '#00897B', label: 'Teal',    colorKey: 'teal'   },
  { index: 4,  color: '#1E88E5', label: 'Blu',     colorKey: 'blue'   },
  { index: 5,  color: '#8E24AA', label: 'Viola',   colorKey: 'purple' },
  { index: 6,  color: '#43A047', label: 'Verde',   colorKey: 'green'  },
  { index: 7,  color: '#FB8C00', label: 'Arancio', colorKey: 'orange' },
  { index: 8,  color: '#E53935', label: 'Rosso',   colorKey: 'red'    },
  { index: 9,  color: '#E91E63', label: 'Rosa',    colorKey: 'pink'   },
  { index: 10, color: '#3949AB', label: 'Indigo',  colorKey: 'indigo' },
]

const AXS_ICON_MAP: Record<string, string> = {
  pdf: '/icons/axs_pdf.svg',
  doc: '/icons/axs_doc.svg',
  docx: '/icons/axs_docx.svg',
  xls: '/icons/axs_xls.svg',
  xlsx: '/icons/axs_xlsx.svg',
  ppt: '/icons/axs_ppt.svg',
  pptx: '/icons/axs_pptx.svg',
  mp4: '/icons/axs_mp4.svg',
  mp3: '/icons/axs_mp3.svg',
  wav: '/icons/axs_wav.svg',
  png: '/icons/axs_png.svg',
  jpg: '/icons/axs_jpg.svg',
  jpeg: '/icons/axs_jpeg.svg',
  gif: '/icons/axs_gif.svg',
  zip: '/icons/axs_zip.svg',
  rar: '/icons/axs_rar.svg',
  txt: '/icons/axs_txt.svg',
  csv: '/icons/axs_csv.svg',
}

/**
 * Per file con estensione .axs (es. "documento.pdf.axs"): estrae l'estensione originale
 * e restituisce l'icona AXS corrispondente. Se non in mappa → '/icons/axs_axs.svg'.
 */
export function getAxsFileIcon(originalName: string): string {
  if (!originalName || typeof originalName !== 'string') return '/icons/axs_axs.svg'
  const withoutAxs = originalName.endsWith('.axs') ? originalName.slice(0, -4) : originalName
  const lastDot = withoutAxs.lastIndexOf('.')
  if (lastDot === -1) return '/icons/axs_axs.svg'
  const ext = withoutAxs.slice(lastDot + 1).toLowerCase()
  return AXS_ICON_MAP[ext] ?? '/icons/axs_axs.svg'
}

/**
 * File cifrati desktop (estensione .axshare): documento.pdf.axshare
 */
export function getAxshareFileIcon(fileName: string): string {
  const withoutAxshare = fileName.endsWith('.axshare')
    ? fileName.slice(0, -8)
    : fileName
  const parts = withoutAxshare.split('.')
  const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
  return AXS_ICON_MAP[ext] ?? '/icons/axs_axs.svg'
}

function getExtension(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') return ''
  const lastDot = fileName.lastIndexOf('.')
  if (lastDot === -1) return ''
  return fileName.slice(lastDot + 1).toLowerCase()
}

/**
 * Restituisce l'URL dell'icona per un file.
 * Per i PDF, se isSigned === true usa l'icona "signed" (pdf_icon_signed.png).
 */
export function getFileIcon(fileName: string, isSigned?: boolean): string {
  const ext = getExtension(fileName)
  if (ext === 'pdf' && isSigned) return FILE_ICON_MAP.pdf_signed.src
  return FILE_ICON_MAP[ext]?.src ?? DEFAULT_FILE_ICON.src
}

export function getFileLabel(fileName: string): string {
  const ext = getExtension(fileName)
  return FILE_ICON_MAP[ext]?.label ?? DEFAULT_FILE_ICON.label
}

export function getFolderIcon(_folderName: string): string {
  const index = Math.abs(
    _folderName.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  ) % FOLDER_ICONS.length
  return FOLDER_ICONS[index]
}

/** Restituisce il path dell'icona cartella per indice 1-6 (per menu contestuale / preferenza). */
export function getFolderIconByIndex(index: 1 | 2 | 3 | 4 | 5 | 6): string {
  return FOLDER_ICONS[index - 1]
}

export function getFolderColorIcon(color: string, isEncrypted: boolean): string {
  const entry = FOLDER_COLOR_MAP[color] ?? FOLDER_COLOR_MAP['yellow']
  return isEncrypted ? entry.locked : entry.normal
}
