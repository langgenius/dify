import type { CreateAppPayload, PostAppsResponse } from '@dify/contracts/api/console/apps/types.gen'
import { zPostAppsResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { assertE2EResourceName, createE2EResourceName } from '../naming'
import { createConsoleApiContext, expectApiResponseOK } from './console-context'

export async function createTestApp(
  name = createE2EResourceName('App'),
  mode: CreateAppPayload['mode'] = 'workflow',
): Promise<PostAppsResponse> {
  assertE2EResourceName(name, 'App')
  const ctx = await createConsoleApiContext()
  try {
    const data = {
      name,
      mode,
      icon_type: 'emoji',
      icon: '🤖',
      icon_background: '#FFEAD5',
    } satisfies CreateAppPayload
    const response = await ctx.post('/console/api/apps', { data })
    await expectApiResponseOK(response, `Create ${mode} app ${name}`)
    return zPostAppsResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function deleteTestApp(id: string): Promise<void> {
  const ctx = await createConsoleApiContext()
  try {
    const response = await ctx.delete(`/console/api/apps/${id}`)
    await expectApiResponseOK(response, `Delete app ${id}`)
  } finally {
    await ctx.dispose()
  }
}
