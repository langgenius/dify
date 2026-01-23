type UploadToPresignedUrlOptions = {
  file: File
  uploadUrl: string
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

export async function uploadToPresignedUrl({
  file,
  uploadUrl,
  onProgress,
  signal,
}: UploadToPresignedUrlOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort()
        reject(new DOMException('Upload aborted', 'AbortError'))
      })
    }

    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100))
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300)
        resolve()
      else
        reject(new Error(`Upload failed with status ${xhr.status}`))
    }

    xhr.onerror = () => reject(new Error('Upload network error'))
    xhr.ontimeout = () => reject(new Error('Upload timeout'))

    xhr.send(file)
  })
}
