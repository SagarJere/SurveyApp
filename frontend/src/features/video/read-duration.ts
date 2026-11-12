const TIMEOUT_MS = 15_000

export type VideoCheck = { ok: true; duration: number | null } | { ok: false }

/**
 * Load just a video's metadata in the browser: its length, and whether this browser can play
 * it from here at all (an internal link only works on the office network or VPN).
 */
export function checkVideo(source: string | File): Promise<VideoCheck> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source)
    let settled = false
    const finish = (result: VideoCheck) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      resolve(result)
    }
    const timer = window.setTimeout(() => {
      finish({ ok: false })
    }, TIMEOUT_MS)
    video.preload = 'metadata'
    video.muted = true
    video.addEventListener('loadedmetadata', () => {
      finish({ ok: true, duration: Number.isFinite(video.duration) ? video.duration : null })
    })
    video.addEventListener('error', () => {
      finish({ ok: false })
    })
    video.src = objectUrl ?? (source as string)
  })
}
