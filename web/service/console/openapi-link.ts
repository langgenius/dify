import type { ClientContext, ClientOptions } from '@orpc/client'
import type { RouterContract } from '@orpc/contract'
import type { OpenAPILinkOptions } from '@orpc/openapi/fetch'
import { FetchLinkTransport } from '@orpc/client/fetch'
import { StandardLink } from '@orpc/client/standard'
import { OpenAPILinkCodec } from '@orpc/openapi/standard'

// A `{name}` placeholder, raw or percent-encoded, left in a request path.
const PATH_PARAM_PLACEHOLDER = /\{([^{}/]+)\}|%7B([^/%]+)%7D/gi

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * oRPC v2 only fills path params that span a whole segment, so custom-method routes such as
 * `/workflows/{workflow_id}:precheck` would send the literal placeholder. This codec fills the
 * placeholders it leaves from the `params` of a detailed input.
 *
 * TODO: drop once oRPC v2 fills params that share a segment with other text.
 */
class InSegmentPathParamsCodec<T extends ClientContext> extends OpenAPILinkCodec<T> {
  override async encodeInput(input: unknown, path: string[], options: ClientOptions<T>) {
    const request = await super.encodeInput(input, path, options)
    const params = isRecord(input) && isRecord(input.params) ? input.params : undefined
    if (!params) return request

    const queryStart = request.url.search(/[?#]/)
    const pathname = queryStart === -1 ? request.url : request.url.slice(0, queryStart)
    const rest = queryStart === -1 ? '' : request.url.slice(queryStart)
    const filled = pathname
      .slice(1)
      .replace(PATH_PARAM_PLACEHOLDER, (placeholder, raw?: string, encoded?: string) => {
        const value = params[raw ?? encoded ?? '']
        return value === undefined || value === null
          ? placeholder
          : encodeURIComponent(String(value))
      })
    return { ...request, url: `/${filled}${rest}` as const }
  }
}

/** `OpenAPILink` that also fills path params sharing a segment, e.g. `{id}:verb`. */
export class ConsoleOpenAPILink<T extends ClientContext> extends StandardLink<T> {
  constructor(router: RouterContract, options: OpenAPILinkOptions<T> = {}) {
    super(new InSegmentPathParamsCodec(router, options), new FetchLinkTransport(options), options)
  }
}
