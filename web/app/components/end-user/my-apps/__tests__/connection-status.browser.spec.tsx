import type { ConsumerAppResponse } from '@dify/contracts/api/web/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createTestQueryClient } from '@/test/query-client'
import AppGrid from '../app-grid'

const app: ConsumerAppResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Sales Follow-up Assistant',
  description: 'Research prospects and send personalized follow-up emails.',
  mode: 'workflow',
  icon: '🍯',
  icon_type: 'emoji',
  icon_background: '#D5F5F6',
  app_code: 'sales-assistant',
  is_favorite: false,
  last_used_at: 100,
  connection_status: 'not_configured',
}

it('shows the connection warning only for apps that require configuration and clears it when resolved', async () => {
  const queryClient = createTestQueryClient()
  const apps: ConsumerAppResponse[] = [
    app,
    {
      ...app,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Configured Assistant',
      connection_status: null,
    },
    {
      ...app,
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Legacy Assistant',
      connection_status: undefined,
    },
  ]
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <AppGrid apps={apps} authSession={0} />
    </QueryClientProvider>,
  )

  const warning = screen.getByText('app.endUser.notConfigured')
  await expect.element(warning).toBeVisible()
  expect(warning.elements()).toHaveLength(1)
  await expect
    .element(screen.getByRole('link', { name: app.name }))
    .toHaveAttribute('href', '/workflow/sales-assistant')
  await expect
    .element(
      screen.getByRole('button', {
        name: 'app.endUser.starApp:{"name":"Sales Follow-up Assistant"}',
      }),
    )
    .toBeEnabled()

  await screen.rerender(
    <QueryClientProvider client={queryClient}>
      <AppGrid apps={apps.map((app) => ({ ...app, connection_status: null }))} authSession={0} />
    </QueryClientProvider>,
  )
  await expect.element(warning).not.toBeInTheDocument()
})
