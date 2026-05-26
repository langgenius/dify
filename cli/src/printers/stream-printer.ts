import type { SseEvent } from '../http/sse.js'

export type StreamPrinter = {
  onEvent: (out: NodeJS.WritableStream, errOut: NodeJS.WritableStream, ev: SseEvent) => void
  onEnd: (out: NodeJS.WritableStream, errOut: NodeJS.WritableStream) => void
}
