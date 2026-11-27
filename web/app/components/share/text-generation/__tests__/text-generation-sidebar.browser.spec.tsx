import { QueryClientProvider } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { render } from 'vitest-browser-react'
import { AccessMode } from '@/models/access-control'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { Resolution } from '@/types/app'
import { getWebAppEntryState, WebAppEntryContext } from '../../webapp-entry'
import TextGenerationSidebar from '../text-generation-sidebar'

it('keeps workflow settings above the run form when WebApp account login is disabled', async () => {
  onTestFinished(guardUnexpectedFetch())
  const { NavigationProvider } = createTestNavigation({
    url: '/workflow/test-token',
    params: { token: 'test-token' },
  })
  const entry = getWebAppEntryState({
    parameters: {
      account_login_enabled: false,
      allow_anonymous_end_user_auth: false,
      connection_requirements: [],
      connection_revision: null,
      console_web_url: '',
      requires_end_user_connections: false,
    },
    loginStatus: { logged_in: false, app_logged_in: true },
    canAccess: true,
    appDataReady: true,
    hasError: false,
  })
  const title = 'Weekly report'
  const screen = await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <NavigationProvider>
        <WebAppEntryContext value={entry}>
          <TextGenerationSidebar
            accessMode={AccessMode.PUBLIC}
            allTasksRun
            currentTab="create"
            customConfig={{ remove_webapp_brand: true, replace_webapp_logo: '' }}
            inputs={{}}
            inputsRef={{ current: {} }}
            isInstalledApp={false}
            isBelowMd={false}
            isWorkflow
            onBatchSend={noop}
            onInputsChange={noop}
            onRemoveSavedMessage={() => Promise.resolve()}
            onRunOnceSend={noop}
            onTabChange={noop}
            onVisionFilesChange={noop}
            promptConfig={{ prompt_template: '', prompt_variables: [] }}
            resultExisted={false}
            runControl={null}
            savedMessages={[]}
            siteInfo={{ title, icon_type: 'emoji', icon: '🤖' }}
            systemFeatures={createSystemFeaturesFixture()}
            textToSpeechConfig={null}
            visionConfig={{
              enabled: false,
              number_limits: 0,
              detail: Resolution.low,
              transfer_methods: [],
            }}
          />
        </WebAppEntryContext>
      </NavigationProvider>
    </QueryClientProvider>,
  )

  const settings = screen.getByRole('button', { name: 'common.operation.more' })
  const run = screen.getByRole('button', { name: 'share.generation.run' })
  await expect.element(settings).toBeVisible()
  await expect.element(run).toBeEnabled()
  expect(
    settings.element().compareDocumentPosition(run.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()
  await expect.element(screen.getByText(title, { exact: true })).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: title })).not.toBeInTheDocument()
  await expect.element(screen.getByText('share.chat.poweredBy')).not.toBeInTheDocument()
})
