import type { CreateAppPayload, PostAppsResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ConsoleClient } from './console-client'
import { assertE2EResourceName, createE2EResourceName } from '../naming'

export async function createTestApp(
  client: ConsoleClient,
  name = createE2EResourceName('App'),
  mode: CreateAppPayload['mode'] = 'workflow',
): Promise<PostAppsResponse> {
  assertE2EResourceName(name, 'App')
  const body = {
    name,
    mode,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
  } satisfies CreateAppPayload

  return client.apps.post({ body })
}
