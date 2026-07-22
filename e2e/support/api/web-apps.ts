import type {
  AppDetailWithSite,
  AppSiteStatusPayload,
  GetAppsByAppIdResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import { zGetAppsByAppIdResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { createConsoleApiContext, expectApiResponseOK } from './console-context'

export function getAppSiteURL({ mode, site }: AppDetailWithSite): string {
  if (!site?.app_base_url || !site.access_token)
    throw new Error('App detail does not include a Web App URL.')

  const webAppMode = (() => {
    if (mode === 'completion' || mode === 'workflow') return mode
    if (mode === 'advanced-chat' || mode === 'agent-chat' || mode === 'chat') return 'chat'
    throw new Error(`Unsupported Web App mode: ${mode}`)
  })()

  return `${site.app_base_url}/${webAppMode}/${site.access_token}`
}

export async function getAppSiteDetail(appId: string): Promise<GetAppsByAppIdResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const response = await ctx.get(`/console/api/apps/${appId}`)
    await expectApiResponseOK(response, `Get app site detail for ${appId}`)
    return zGetAppsByAppIdResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function enableAppSiteAndGetURL(appId: string): Promise<string> {
  await setAppSiteEnabled(appId, true)
  return getAppSiteURL(await getAppSiteDetail(appId))
}

export async function setAppSiteEnabled(appId: string, enabled: boolean): Promise<void> {
  const ctx = await createConsoleApiContext()
  try {
    const data = { enable_site: enabled } satisfies AppSiteStatusPayload
    const enableResponse = await ctx.post(`/console/api/apps/${appId}/site-enable`, { data })
    await expectApiResponseOK(enableResponse, `${enabled ? 'Enable' : 'Disable'} app site ${appId}`)
  } finally {
    await ctx.dispose()
  }
}
