import { api } from './api'

/** Download a file from an authenticated API endpoint (the browser can't add the token). */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await api.get<Blob>(path, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
  } finally {
    // Give the browser a moment to start the download before freeing the blob.
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }
}
