import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { public_ as publicHumanInputV2Contract } from '@dify/contracts/api/web/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'

const humanInputV2FormContract = {
  getForm: publicHumanInputV2Contract.byFormToken.get,
  requestAccess: publicHumanInputV2Contract.byFormToken.accessRequest.post,
  requestUploadToken: publicHumanInputV2Contract.byFormToken.uploadToken.post,
  submit: publicHumanInputV2Contract.byFormToken.post,
}
export const humanInputV2FormClient: JsonifiedClient<
  ContractRouterClient<typeof humanInputV2FormContract>
> = createORPCClient(
  new OpenAPILink(humanInputV2FormContract, {
    url: () => new URL(PUBLIC_API_PREFIX, window.location.origin),
    fetch: (request, init) =>
      globalThis.fetch(request, {
        ...init,
        credentials: 'omit',
        cache: 'no-store',
      }),
  }),
)
