'use client'

import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { API_PREFIX } from '@/config'
import { consoleRouterContract } from '@/contract/router'
// eslint-disable-next-line no-restricted-imports
import { request } from '@/service/base'
import { getBaseURL } from '@/service/client'

type AgentConfigureConsoleClientContext = {
  silent?: boolean
}

const agentConfigureConsoleLink = new OpenAPILink<AgentConfigureConsoleClientContext>(consoleRouterContract, {
  url: getBaseURL(API_PREFIX),
  fetch: (input, init, options) => {
    return request(
      input.url,
      init,
      {
        fetchCompat: true,
        request: input,
        silent: options.context.silent,
      },
    )
  },
})

const agentConfigureConsoleClient: JsonifiedClient<ContractRouterClient<typeof consoleRouterContract, AgentConfigureConsoleClientContext>>
  = createORPCClient(agentConfigureConsoleLink)

export const agentConfigureConsoleQuery = createTanstackQueryUtils(agentConfigureConsoleClient, {
  path: ['console'],
})
