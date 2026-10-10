import type { ErrorEnvelope } from './base'
import type { IOService } from '@/plugins/io'
import { redactBearer } from '@/errors/sanitize'
import { Channel } from '@/plugins/io'
import { view } from '@/sys/io/view'
import { BaseError } from './base'
import { ErrorCode, ExitCode, exitFor } from './codes'
import { renderEnvelope } from './format'
import { errorMessage } from './message'

const EPIPE = 'EPIPE'

/** A reader that closed stdout (`| head`) ends a run; it never fails it. */
export function isBrokenPipe(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === EPIPE
}

function envelopeFor(err: unknown): ErrorEnvelope {
  if (err instanceof BaseError) return err.toEnvelope()
  return {
    error: {
      code: ErrorCode.Unknown,
      message: errorMessage(err),
    },
  }
}

// The text form reads the whole envelope: a hidden raw response is what makes it offer
// --verbose. Only the JSON form drops the body, and both see it redacted.
function jsonForm(envelope: ErrorEnvelope, verbose: boolean): ErrorEnvelope {
  if (verbose) return envelope
  const error = { ...envelope.error }
  delete error.raw_response
  return { error }
}

export async function printEnvelope(
  err: unknown,
  io: IOService,
  opts: { readonly verbose: boolean },
): Promise<number> {
  if (isBrokenPipe(err)) return ExitCode.Success

  const envelope = envelopeFor(err)
  const raw = envelope.error.raw_response
  if (raw !== undefined) envelope.error.raw_response = redactBearer(raw)

  await io.emit(
    view(jsonForm(envelope, opts.verbose), (style) => renderEnvelope(envelope, style, opts)),
    Channel.Err,
  )
  return exitFor(envelope.error.code)
}
