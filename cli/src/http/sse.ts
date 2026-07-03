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
  let resolveNext: (() => void) | undefined
  let pendingWake = false
  let done = false

  const wake = (): void => {
    pendingWake = true
    if (resolveNext !== undefined) {
      const r = resolveNext
      resolveNext = undefined
      r()
    }
  }

  const enc = new TextEncoder()
  const parser = createParser({
    onEvent(ev) {
      queue.push({
        name: ev.event ?? '',
        data: enc.encode(ev.data),
        id: ev.id,
      })
      wake()
    },
  })

  const reader = body.getReader()
  const dec = new TextDecoder('utf-8')

  const onAbort = (): void => {
    reader.cancel().catch(() => {})
  }
  if (signal !== undefined) {
    if (signal.aborted)
      onAbort()
    else
      signal.addEventListener('abort', onAbort, { once: true })
  }

  const pump = (async () => {
    try {
      while (true) {
        if (signal?.aborted) {
          const e = new Error('aborted')
          e.name = 'AbortError'
          throw e
        }
        const { value, done: rDone } = await reader.read()
        if (rDone)
          break
        parser.feed(dec.decode(value, { stream: true }))
      }
    }
    finally {
      done = true
      wake()
      try {
        reader.releaseLock()
      }
      catch {}
    }
  })()

  try {
    while (true) {
      while (queue.length > 0) {
        const ev = queue.shift()
        if (ev !== undefined)
          yield ev
      }
      if (done) {
        await pump
        return
      }
      if (pendingWake) {
        pendingWake = false
        continue
      }
      await new Promise<void>((res) => {
        resolveNext = res
      })
      pendingWake = false
    }
  }
  finally {
    if (signal !== undefined)
      signal.removeEventListener('abort', onAbort)
    if (!done) {
      try {
        await reader.cancel()
      }
      catch {}
    }
  }
}
