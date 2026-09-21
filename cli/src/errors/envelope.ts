import type { ErrorEnvelope } from './base'
import type { IOStreams } from '@/sys/io/streams'
import { redactBearer } from '@/errors/sanitize'
import { BaseError } from './base'
import { ErrorCode, ExitCode, exitFor } from './codes'
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

export function printEnvelope(
  err: unknown,
  io: IOStreams,
  opts: { readonly verbose: boolean },
): number {
  if (isBrokenPipe(err)) return ExitCode.Success

  const envelope = envelopeFor(err)
  const raw = envelope.error.raw_response
  if (!opts.verbose) delete envelope.error.raw_response
  else if (raw !== undefined) envelope.error.raw_response = redactBearer(raw)

  io.err.write(`${JSON.stringify(envelope)}\n`)
  return exitFor(envelope.error.code)
}
