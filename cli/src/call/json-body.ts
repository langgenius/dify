import type { Printable } from '@/plugins/io'
import { HttpClientError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

const CONTENT_TYPE_HEADER = 'content-type'
const NON_JSON_BODY_PREVIEW_LENGTH = 200

/** The one guard for a response the catalog promised would be JSON. */
export async function parseJsonBody(res: Response): Promise<Printable> {
  const text = await res.text()
  try {
    return JSON.parse(text) as Printable
  } catch (cause) {
    const contentType = res.headers.get(CONTENT_TYPE_HEADER)
    throw new HttpClientError({
      code: ErrorCode.ServerError,
      message:
        contentType !== null
          ? `response is not JSON (content-type: ${contentType})`
          : 'response is not JSON',
      cause,
      rawResponse: text.slice(0, NON_JSON_BODY_PREVIEW_LENGTH),
    })
  }
}
