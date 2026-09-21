import type { Renderer } from './index'
import { exitCodeFor, finishFold, foldEvent, newFoldResult } from '@/call/fold'
import { parseSSE } from '@/call/sse'
import { normalizeDifyStream } from '@/call/sse-dify'
import { isBrokenPipe } from '@/errors/envelope'
import { errorMessage } from '@/errors/message'
import { isRecord } from '@/util/is-record'

const dec = new TextDecoder()
const STREAM_ENDED_EARLY_PREFIX = 'stream ended early: '

function parseEventData(data: Uint8Array): Record<string, unknown> {
  try {
    const obj = JSON.parse(dec.decode(data)) as unknown
    return isRecord(obj) ? obj : {}
  } catch {
    return {}
  }
}

function matchesOnly(name: string, only: readonly string[] | undefined): boolean {
  return only === undefined || only.length === 0 || only.includes(name)
}

// A run that dies mid-stream still folds to whatever arrived: the events already
// seen are real, so they are reported as an `incomplete` result rather than thrown
// away behind a network error.
export const sseRenderer: Renderer = async (res, io, options) => {
  const result = newFoldResult()
  const stream = options.stream ?? false

  if (res.body !== null) {
    try {
      for await (const ev of normalizeDifyStream(parseSSE(res.body))) {
        const parsed = parseEventData(ev.data)
        foldEvent(result, ev.name, parsed)
        if (stream && matchesOnly(ev.name, options.only)) await io.line(parsed)
      }
    } catch (err) {
      if (isBrokenPipe(err)) throw err
      io.notice(`${STREAM_ENDED_EARLY_PREFIX}${errorMessage(err)}`)
    }
  }

  if (!stream) await io.line(finishFold(result))
  return exitCodeFor(result)
}
