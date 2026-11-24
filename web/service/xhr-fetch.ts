type UploadProgress = {
  loaded: number
  total: number
}

export type OnUploadProgress = (progress: UploadProgress) => void

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function parseResponseHeaders(xhr: XMLHttpRequest) {
  const headers = new Headers()
  for (const line of xhr
    .getAllResponseHeaders()
    .trim()
    .split(/[\r\n]+/)) {
    const separator = line.indexOf(':')
    if (separator > 0) headers.append(line.slice(0, separator), line.slice(separator + 1).trim())
  }
  return headers
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

/**
 * A `fetch` replacement that sends the request over XHR so the request body's upload
 * progress can be observed. Fetch cannot report upload progress across browsers.
 */
// oxlint-disable-next-line no-restricted-globals -- The XHR transport implements the fetch signature for the shared request layer.
export function createXhrFetch(onUploadProgress: OnUploadProgress): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const { signal } = request
    if (signal.aborted) throw abortReason(signal)

    // Firefox has no `Request.body`, so read the body for every method that can carry one.
    const body = request.method === 'GET' || request.method === 'HEAD' ? null : await request.blob()
    if (signal.aborted) throw abortReason(signal)

    return new Promise<Response>((resolve, reject) => {
      // oxlint-disable-next-line no-restricted-globals -- Only XHR reports request-body upload progress in every browser.
      const xhr = new XMLHttpRequest()
      const onAbort = () => xhr.abort()
      const cleanup = () => signal.removeEventListener('abort', onAbort)

      xhr.open(request.method, request.url)
      request.headers.forEach((value, key) => xhr.setRequestHeader(key, value))
      xhr.withCredentials = request.credentials === 'include'
      xhr.responseType = 'blob'
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onUploadProgress({ loaded: event.loaded, total: event.total })
      }
      xhr.onload = () => {
        cleanup()
        resolve(
          new Response(NULL_BODY_STATUSES.has(xhr.status) ? null : (xhr.response as Blob), {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: parseResponseHeaders(xhr),
          }),
        )
      }
      xhr.onerror = () => {
        cleanup()
        reject(new TypeError('Failed to fetch'))
      }
      xhr.onabort = () => {
        cleanup()
        reject(abortReason(signal))
      }
      xhr.ontimeout = () => {
        cleanup()
        reject(new DOMException('The operation timed out.', 'TimeoutError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      xhr.send(body)
    })
  }
}
