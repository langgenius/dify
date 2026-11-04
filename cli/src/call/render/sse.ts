import type { Renderer } from './index'
import { exitCodeFor, finishFold, foldBrokenStream, foldEvent, newFoldResult } from '@/call/fold'
import { parseSSE } from '@/call/sse'
import { normalizeDifyStream } from '@/call/sse-dify'
import { isBrokenPipe } from '@/errors/envelope'
import { errorMessage } from '@/errors/message'
import { FOLD_STATUS } from '@/protocol/fold'
import { isRecord } from '@/util/is-record'

const dec = new TextDecoder()
const STREAM_ENDED_EARLY_PREFIX = 'stream ended early: '
const STREAM_CLOSED_EARLY = 'stream closed before the run finished'
// Bun appends this to its fetch errors; it tells the reader nothing about the failure.
const RUNTIME_ADVICE =
  /\.?\s*For more information, pass `verbose: true` in the second argument to fetch\(\)\s*$/

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
export const sseRenderer: Renderer = async (res, io, options, { input, tokenFromEnv }) => {
  const result = newFoldResult()
  const stream = options.stream ?? false

  let failed = false
  if (res.body !== null) {
    try {
      for await (const ev of normalizeDifyStream(parseSSE(res.body))) {
        foldEvent(result, ev.name, parseEventData(ev.data))
        if (stream && matchesOnly(ev.name, options.only)) await io.raw(`${dec.decode(ev.data)}\n`)
      }
    } catch (err) {
      if (isBrokenPipe(err)) throw err
      io.notice(`${STREAM_ENDED_EARLY_PREFIX}${errorMessage(err).replace(RUNTIME_ADVICE, '')}`)
      failed = true
    }
  }

  if (result.status === FOLD_STATUS.Incomplete && !failed) io.notice(STREAM_CLOSED_EARLY)
  if (!tokenFromEnv) foldBrokenStream(result, input)

  if (!stream) await io.document(finishFold(result))
  return exitCodeFor(result)
}
