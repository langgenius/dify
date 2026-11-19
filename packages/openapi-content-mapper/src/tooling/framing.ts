import { Buffer } from 'node:buffer'

/** Assemble each payload once, even when a large document arrives in tiny chunks. */
export async function* readFrames(input: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
  let header: Buffer = Buffer.alloc(0)
  let body: Buffer | undefined
  let received = 0
  for await (let chunk of input) {
    while (chunk.length) {
      if (!body) {
        header = header.length ? Buffer.concat([header, chunk]) : chunk
        const end = header.indexOf('\r\n\r\n')
        if (end < 0) {
          if (header.length > 8192) throw new Error('Invalid content mapper header')
          break
        }
        const match = /^Content-Length:\s*(\d+)\s*$/im.exec(
          header.subarray(0, end).toString('ascii'),
        )
        const length = Number(match?.[1])
        if (!match || end > 8192 || !Number.isSafeInteger(length) || length > 64 * 1024 * 1024)
          throw new Error('Invalid content mapper frame')
        body = Buffer.allocUnsafe(length)
        received = 0
        chunk = header.subarray(end + 4)
        header = Buffer.alloc(0)
      }
      const count = Math.min(body.length - received, chunk.length)
      chunk.copy(body, received, 0, count)
      received += count
      chunk = chunk.subarray(count)
      if (received === body.length) {
        yield body
        body = undefined
      }
    }
  }
  if (body || header.length) throw new Error('Incomplete content mapper frame')
}
