import { COMMON_ERROR_STATUS_MAP, ORPCError } from '@orpc/client'

const codeByStatus = new Map<number, string>(
  Object.entries(COMMON_ERROR_STATUS_MAP).map(([code, status]) => [status, code]),
)

/**
 * A Console API error response. The backend answers with its own error body instead of an
 * oRPC one, and oRPC v2 errors carry no HTTP status, so both are kept here.
 */
export class ConsoleHttpError extends ORPCError<string, { body: unknown }> {
  readonly status: number

  constructor(status: number, body: unknown) {
    super(codeByStatus.get(status) ?? 'HTTP_ERROR', { data: { body } })
    this.status = status
  }
}
