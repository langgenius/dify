import { createParser } from 'eventsource-parser'

export type SseEvent = {
  name: string
  data: Uint8Array
  id?: string
}

export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent, void, void> {
  const queue: SseEvent[] = []
  const enc = new TextEncoder()
  const parser = createParser({
    onEvent(ev) {
      queue.push({
        name: ev.event ?? '',
        data: enc.encode(ev.data),
        id: ev.id,
      })
    },
  })

  const reader = body.getReader()
  const dec = new TextDecoder('utf-8')
  let done = false

  const onAbort = (): void => {
    reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    while (true) {
      signal?.throwIfAborted()
      const next = await reader.read()
      signal?.throwIfAborted()
      if (next.done) {
        done = true
        return
      }
      parser.feed(dec.decode(next.value, { stream: true }))
      // Drain this chunk before reading more from the response.
      yield* queue
      queue.length = 0
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    if (!done) {
      try {
        await reader.cancel()
      } catch {}
    }
    reader.releaseLock()
  }
}
