import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import {
  get2 as getHumanInputV2Form,
  post13 as requestHumanInputV2Access,
  post14 as requestHumanInputV2UploadToken,
  post16 as submitHumanInputV2Form,
} from '@dify/contracts/api/web/orpc.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'

// The generated aggregate merges human-input and human_input into the same key.
// Select the generated v2 operations explicitly so public tokens never reach v1.
const humanInputV2FormContract = {
  getForm: getHumanInputV2Form,
  requestAccess: requestHumanInputV2Access,
  requestUploadToken: requestHumanInputV2UploadToken,
  submit: submitHumanInputV2Form,
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
