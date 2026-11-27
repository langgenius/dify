import type {
  ConsumerAppsResponse,
  ConsumerConnectionResponse,
} from '@dify/contracts/api/web/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, expect, it, vi } from 'vite-plus/test'
import { route, setupFakeApi } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import LinkedAppsDialog from '../provider-connections/linked-apps-dialog'

// Use Next's real Link with the base path it normally receives at build time.
const basePath = vi.hoisted(() => {
  vi.stubEnv('__NEXT_ROUTER_BASEPATH', '/dify')
  return '/dify'
})

// boundary: uses the same deployment prefix for Dify's runtime configuration.
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  basePath,
}))

afterAll(() => vi.unstubAllEnvs())

const connection: ConsumerConnectionResponse = {
  key: '11111111-1111-4111-8111-111111111111',
  provider: 'langgenius/google/drive',
  name: 'Work account',
  account_label: null,
  connection_type: 'oauth2',
  webapps_count: 1,
}

setupFakeApi({
  routes: [
    route(
      'GET',
      'public',
      `/me/connections/${connection.key}/apps`,
      () =>
        ({
          data: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Planning Assistant',
              description: 'Plan the next project milestone',
              mode: 'advanced-chat',
              icon: null,
              icon_type: null,
              icon_background: null,
              app_code: 'planning-app',
              is_favorite: false,
              last_used_at: null,
            },
          ],
          next_cursor: null,
          has_more: false,
        }) satisfies ConsumerAppsResponse,
    ),
  ],
})

it('opens the linked app in a new tab with the deployment base path applied once', async () => {
  const client = createTestQueryClient()
  onTestFinished(() => client.clear())
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <p id="connection-name">{connection.name}</p>
      <LinkedAppsDialog connection={connection} connectionLabelId="connection-name" />
    </QueryClientProvider>,
  )

  await user.click(screen.getByRole('button', { name: /app.endUser.linkedAppCount/ }))
  const app = await within(screen.getByRole('dialog')).findByRole('link', {
    name: 'Planning Assistant',
  })
  expect(app).toHaveAttribute('href', '/dify/chat/planning-app')
  expect(app).toHaveAttribute('target', '_blank')
})
