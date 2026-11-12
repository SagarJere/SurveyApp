/** "8 min 32 s", "45 s", "1 h 2 min". */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null
  }
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return m ? `${String(h)} h ${String(m)} min` : `${String(h)} h`
  if (m) return s ? `${String(m)} min ${String(s)} s` : `${String(m)} min`
  return `${String(s)} s`
}

/** "142 MB", "850 KB". */
export function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${String(Math.round(mb))} MB`
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
}

/** "fire-safety.mp4" -> "MP4" for display. */
export function videoFormat(contentType: string): string {
  return contentType === 'video/webm' ? 'WebM' : 'MP4'
}

export const ACCEPTED_VIDEO_TYPES = 'video/mp4,video/webm,.mp4,.webm'
