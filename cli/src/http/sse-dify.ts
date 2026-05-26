import type { SseEvent } from './sse.js'

const dec = new TextDecoder()

export function eventNameFromDifyData(data: Uint8Array): string {
  if (data.byteLength === 0)
    return ''
  try {
    const obj = JSON.parse(dec.decode(data)) as unknown
    if (obj === null || typeof obj !== 'object')
      return ''
    const evt = (obj as { event?: unknown }).event
    return typeof evt === 'string' ? evt : ''
  }
  catch {
    return ''
  }
}

// Dify always sends JSON-encoded SSE data. Most endpoints embed the event
// name in the JSON `event` field rather than emitting a transport-level
// `event:` line. This adapter promotes the embedded name into `ev.name`
// so consumers can dispatch uniformly. Transport-level `event:` lines win
// when both are present, preserving compatibility with `event: ping`.
export async function* normalizeDifyStream(
  iter: AsyncIterable<SseEvent>,
): AsyncGenerator<SseEvent, void, void> {
  for await (const ev of iter) {
    if (ev.name !== '') {
      yield ev
      continue
    }
    const name = eventNameFromDifyData(ev.data)
    yield name === '' ? ev : { ...ev, name }
  }
}
