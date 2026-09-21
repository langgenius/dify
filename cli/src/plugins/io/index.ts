import type { Buffer } from 'node:buffer'
import type { IOStreams } from '@/sys/io/streams'
import { definePlugin } from '@/kernel/plugin'
import { realStreams } from '@/sys/io/streams'

type JsonPrimitive = string | number | boolean | null

export type Printable = JsonPrimitive | readonly unknown[] | Record<string, unknown>

export type IOService = Readonly<{
  line: (value: Printable) => Promise<void>
  document: (value: Printable) => Promise<void>
  notice: (text: string) => void
  raw: (chunk: string | Buffer) => Promise<void>
  streams: IOStreams
}>

const JSON_INDENT = 2
const NEWLINE = '\n'

// The callback form reports a reader that closed the pipe as a rejection, so
// `printEnvelope` can end the run at exit 0 instead of the write failing silently.
function writeChunk(stream: NodeJS.WritableStream, chunk: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()))
  })
}

export function ioService(streams: IOStreams): IOService {
  return Object.freeze({
    line: (value) => writeChunk(streams.out, `${JSON.stringify(value)}${NEWLINE}`),
    document: (value) =>
      writeChunk(streams.out, `${JSON.stringify(value, null, JSON_INDENT)}${NEWLINE}`),
    notice: (text) => {
      streams.err.write(`${text}${NEWLINE}`)
    },
    raw: (chunk) => writeChunk(streams.out, chunk),
    streams,
  })
}

export const io = definePlugin({
  name: 'io',
  needs: [],
  build: (): IOService => ioService(realStreams()),
})
