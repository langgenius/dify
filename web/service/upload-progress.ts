/**
 * Upload transport for generated clients, called after the shared auth/CSRF hooks.
 * XHR reports bytes sent without requiring HTTP/2 request streaming support.
 */
export async function fetchWithUploadProgress(
  request: Request,
  onProgress: (percent: number) => void,
): Promise<Response> {
  request.signal.throwIfAborted()
  const body = request.body ? await request.blob() : null
  request.signal.throwIfAborted()

  return new Promise((resolve, reject) => {
    // oxlint-disable-next-line no-restricted-globals -- Fetch does not expose portable upload progress; this adapter retains the generated client's request and shared auth/error pipeline.
    const xhr = new XMLHttpRequest()
    const abort = () => {
      xhr.abort()
      reject(request.signal.reason ?? new DOMException('The request was aborted.', 'AbortError'))
    }
    const cleanup = () => request.signal.removeEventListener('abort', abort)
    xhr.open(request.method, request.url)
    xhr.withCredentials = request.credentials === 'include'
    xhr.responseType = 'arraybuffer'
    request.headers.forEach((value, name) => xhr.setRequestHeader(name, value))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
    }
    xhr.onload = () => {
      cleanup()
      const headers = new Headers()
      for (const line of xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)) {
        const colon = line.indexOf(':')
        if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim())
      }
      resolve(
        new Response([204, 205, 304].includes(xhr.status) ? null : xhr.response, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers,
        }),
      )
    }
    xhr.onerror = () => {
      cleanup()
      reject(new TypeError('Failed to fetch'))
    }
    xhr.onabort = () => {
      cleanup()
      reject(request.signal.reason ?? new DOMException('The request was aborted.', 'AbortError'))
    }
    request.signal.addEventListener('abort', abort, { once: true })
    xhr.send(body)
  })
}
