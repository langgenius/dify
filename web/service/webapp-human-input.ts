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
const formClient: JsonifiedClient<ContractRouterClient<typeof formContract, { silent?: boolean }>> =
  createORPCClient(
    new OpenAPILink(formContract, {
      url: () => new URL(PUBLIC_API_PREFIX, window.location.origin),
      fetch: (input, init, options) => {
        const url = new URL(input.url)
        const prefix = new URL(PUBLIC_API_PREFIX, window.location.origin).pathname.replace(
          /\/$/,
          '',
        )
        const path = url.pathname.slice(prefix.length)
        url.pathname = prefix + getWebAppPublicApiPath(resolveWebAppAddress(), path)
        const normalizedRequest = url.href === input.url ? input : new Request(url, input)
        return request<Response>(url.href, init, {
          fetchCompat: true,
          request: normalizedRequest,
          isPublicAPI: true,
          silent: options.context.silent,
        })
      },
    }),
  )

async function isV2FormNotFound(error: unknown) {
  if (!(error instanceof Response) || error.status !== 404) return false
  try {
    const body: unknown = await error.clone().json()
    return typeof body === 'object' && body !== null && 'code' in body && body.code === 'not_found'
  } catch {
    return false
  }
}

export async function submitWebAppHumanInputForm(
  formToken: string,
  data: Parameters<typeof submitHumanInputForm>[1],
) {
  // Resolve the form with the passport-aware transport before writing, so
  // failed V2 submissions never retry through V1.
  try {
    await formClient.get({ params: { form_token: formToken } }, { context: { silent: true } })
  } catch (error) {
    if (await isV2FormNotFound(error)) return submitHumanInputForm(formToken, data)
    throw error
  }

  return formClient.post({
    params: { form_token: formToken },
    body: zWebAppHumanInputV2SubmitPayload.parse(data),
  })
}
