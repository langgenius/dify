'use client'

import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import type { ConsoleRouterContract } from '@/service/console-link'
import { createORPCClient } from '@orpc/client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { API_PREFIX } from '@/config'
// eslint-disable-next-line no-restricted-imports
import { request } from '@/service/base'
import { getBaseURL } from '@/service/client'
import { createConsoleDynamicLink } from '@/service/console-link'

type AgentConfigureConsoleClientContext = {
  silent?: boolean
}

const agentConfigureConsoleLink = createConsoleDynamicLink<AgentConfigureConsoleClientContext>(contract => new OpenAPILink<AgentConfigureConsoleClientContext>(contract, {
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
}))

const agentConfigureConsoleClient: JsonifiedClient<ContractRouterClient<ConsoleRouterContract, AgentConfigureConsoleClientContext>>
  = createORPCClient(agentConfigureConsoleLink)

export const agentConfigureConsoleQuery = createTanstackQueryUtils(agentConfigureConsoleClient, {
  path: ['console'],
})
