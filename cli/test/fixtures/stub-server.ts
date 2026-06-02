import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import * as http from 'node:http'

// Records what the client actually put on the wire so API-client tests can
// assert method / path / query / body / headers without mocking fetch.
export type CapturedRequest = {
  method?: string
  url?: string
  body?: string
  headers?: http.IncomingHttpHeaders
}

export type StubServer = {
  readonly url: string
  readonly captured: CapturedRequest
  readonly stop: () => Promise<void>
}

// Buffers the request body, captures the request line + headers, then replies
// with a JSON payload and a matching Content-Length.
export function jsonResponder(
  status: number,
  body: unknown,
  captured: CapturedRequest,
): http.RequestListener {
  return (req, res) => {
    captured.method = req.method
    captured.url = req.url
    captured.headers = req.headers
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      captured.body = Buffer.concat(chunks).toString('utf8')
      const payload = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      })
      res.end(payload)
    })
  }
}

// Starts a throwaway loopback server. The handler is built from the same
// `captured` object the caller reads back via `stub.captured`, so there is no
// reassignment dance between the listener and the assertions.
export function startStubServer(
  makeHandler: (captured: CapturedRequest) => http.RequestListener,
): Promise<StubServer> {
  const captured: CapturedRequest = {}
  const handler = makeHandler(captured)
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => handler(req, res))
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        captured,
        stop: () =>
          new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
      })
    })
    server.on('error', reject)
  })
}
