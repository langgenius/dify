type FakeXhrResponse = {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

/** Minimal XMLHttpRequest stand-in that records the request and lets a test drive upload and response events. */
export class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []

  method = ''
  url = ''
  requestHeaders: Record<string, string> = {}
  body: Document | XMLHttpRequestBodyInit | null = null
  withCredentials = false
  responseType: XMLHttpRequestResponseType = ''
  status = 0
  statusText = ''
  response: unknown = null
  aborted = false
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  private responseHeaders: Record<string, string> = {}

  constructor() {
    FakeXMLHttpRequest.instances.push(this)
  }

  static latest() {
    const xhr = FakeXMLHttpRequest.instances.at(-1)
    if (!xhr) throw new Error('No XMLHttpRequest was created')
    return xhr
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name.toLowerCase()] = value
  }

  send(body: Document | XMLHttpRequestBodyInit | null = null) {
    this.body = body
  }

  abort() {
    this.aborted = true
    this.onabort?.()
  }

  getAllResponseHeaders() {
    return Object.entries(this.responseHeaders)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join('')
  }

  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.(new ProgressEvent('progress', { lengthComputable, loaded, total }))
  }

  respond({ status, body, headers = {} }: FakeXhrResponse) {
    this.status = status
    this.responseHeaders =
      body === undefined ? headers : { 'content-type': 'application/json', ...headers }
    this.response =
      body === undefined ? null : new Blob([JSON.stringify(body)], { type: 'application/json' })
    this.onload?.()
  }

  fail() {
    this.onerror?.()
  }
}
