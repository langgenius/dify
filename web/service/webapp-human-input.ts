import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { v2 as webAppHumanInputV2Contract } from '@dify/contracts/api/web/orpc.gen'
import { zWebAppHumanInputV2SubmitPayload } from '@dify/contracts/api/web/zod.gen'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { PUBLIC_API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- Preserve Webapp passport, authorization recovery, and request error handling in the generated transport.
import { request } from './base'
import { submitHumanInputForm } from './share'
import { getWebAppPublicApiPath, resolveWebAppAddress } from './webapp-address'

const formContract = webAppHumanInputV2Contract.byFormToken
const formClient: JsonifiedClient<ContractRouterClient<typeof formContract>> = createORPCClient(
  new OpenAPILink(formContract, {
    url: () => new URL(PUBLIC_API_PREFIX, window.location.origin),
    fetch: (input, init) => {
      const url = new URL(input.url)
      const prefix = new URL(PUBLIC_API_PREFIX, window.location.origin).pathname.replace(/\/$/, '')
      const path = url.pathname.slice(prefix.length)
      url.pathname = prefix + getWebAppPublicApiPath(resolveWebAppAddress(), path)
      const normalizedRequest = url.href === input.url ? input : new Request(url, input)
      // oxlint-disable-next-line typescript/no-deprecated -- The generated public form client needs the Web App transport's passport scope and authorization recovery.
      return request<Response>(url.href, init, {
        fetchCompat: true,
        request: normalizedRequest,
        isPublicAPI: true,
      })
    },
  }),
)

export async function submitWebAppHumanInputForm(
  formToken: string,
  data: Parameters<typeof submitHumanInputForm>[1],
  formVersion?: Parameters<typeof submitHumanInputForm>[2],
) {
  if (formVersion !== '2') return submitHumanInputForm(formToken, data)

  return formClient.post({
    params: { form_token: formToken },
    body: zWebAppHumanInputV2SubmitPayload.parse(data),
  })
}
