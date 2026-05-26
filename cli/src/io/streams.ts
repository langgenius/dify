import { Buffer } from 'node:buffer'
import { PassThrough, Readable, Writable } from 'node:stream'

export type IOStreams = {
  out: NodeJS.WritableStream
  err: NodeJS.WritableStream
  in: NodeJS.ReadableStream
  isOutTTY: boolean
  isErrTTY: boolean
  outputFormat: string
}

export function nullStreams(): IOStreams {
  return bufferStreams()
}

export function realStreams(outputFormat = ''): IOStreams {
  return {
    out: process.stdout,
    err: process.stderr,
    in: process.stdin,
    isOutTTY: Boolean(process.stdout.isTTY),
    isErrTTY: Boolean(process.stderr.isTTY),
    outputFormat,
  }
}

export type BufferStreams = IOStreams & {
  outBuf: () => string
  errBuf: () => string
}

export function bufferStreams(stdin = ''): BufferStreams {
  const outChunks: Buffer[] = []
  const errChunks: Buffer[] = []
  const out = new Writable({
    write(chunk, _enc, cb) {
      outChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      cb()
    },
  }) as unknown as NodeJS.WritableStream
  const err = new Writable({
    write(chunk, _enc, cb) {
      errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      cb()
    },
  }) as unknown as NodeJS.WritableStream
  const inStream: NodeJS.ReadableStream = stdin === ''
    ? new PassThrough()
    : Readable.from([stdin])
  return {
    out,
    err,
    in: inStream,
    isOutTTY: false,
    isErrTTY: false,
    outputFormat: '',
    outBuf: () => Buffer.concat(outChunks).toString('utf8'),
    errBuf: () => Buffer.concat(errChunks).toString('utf8'),
  }
}
