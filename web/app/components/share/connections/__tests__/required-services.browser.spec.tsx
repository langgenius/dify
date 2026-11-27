import type { WebAppConnectionRequirement } from '@dify/contracts/api/web/types.gen'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { QueryClientProvider } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import plugin from '@/i18n/locales/en-US/plugin.json'
import share from '@/i18n/locales/en-US/share.json'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { getConnectionData } from '../connection-data'
import RequiredConnectionSetup from '../required-connection-setup'

// boundary: use real localized labels for the service cards and existing Verified badge.
vi.mock('react-i18next', async (importOriginal) => importOriginal())

const requirements: WebAppConnectionRequirement[] = [
  {
    node_id: 'google-node',
    node_ids: ['google-node'],
    provider: 'langgenius/google/google',
    provider_label: 'Google',
    title: 'Search files',
    purpose: 'key',
    icon: '',
    icon_dark: null,
    plugin_unique_identifier: 'langgenius/google:1.0.0@digest',
    allowed_credential_types: ['oauth2'],
    verified: true,
  },
  {
    node_id: 'github-node',
    node_ids: ['github-node'],
    provider: 'langgenius/github/github',
    provider_label: 'GitHub',
    title: 'Search repositories',
    purpose: 'Read repositories.',
    icon: '',
    icon_dark: null,
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    allowed_credential_types: ['oauth2'],
    verified: false,
  },
]

it('shows the API verification beside its provider name without changing connection controls', async ({
  onTestFinished,
}) => {
  onTestFinished(guardUnexpectedFetch())
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common, plugin, share } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const queryClient = createTestQueryClient()
  onTestFinished(() => queryClient.clear())
  const onConnect = vi.fn().mockResolvedValue(undefined)
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <main className="p-6">
            <RequiredConnectionSetup
              services={
                getConnectionData({ requirements, connections: [], allConnectionsLoaded: true })
                  .services
              }
              onConnect={onConnect}
              onConnectionChange={vi.fn()}
            />
          </main>
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  const verified = screen.getByRole('listitem', { name: 'Google', exact: true })
  const unverified = screen.getByRole('listitem', { name: 'GitHub', exact: true })
  await expect.element(verified.getByText('Verified by Dify', { exact: true })).toBeInTheDocument()
  await expect
    .element(unverified.getByText('Verified by Dify', { exact: true }))
    .not.toBeInTheDocument()
  const connect = verified.getByRole('button', { name: 'Connect', exact: true })
  await expect.element(connect).toHaveAccessibleDescription('Google key')
  await connect.click()
  expect(onConnect).toHaveBeenCalledExactlyOnceWith('google-node', 'oauth')
})
