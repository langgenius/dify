import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactElement } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import { trackEvent } from '@/app/components/base/amplitude'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import LearnDifyItem from '../item'

let deploymentEdition: DeploymentEdition = 'CLOUD'
async function render(ui: ReactElement) {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: deploymentEdition },
  })
  return renderBrowser(<ConsoleProvider>{ui}</ConsoleProvider>)
}

// boundary: card analytics stop at the telemetry adapter.
vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const createApp = (overrides: Partial<RecommendedAppResponse> = {}): RecommendedAppResponse => ({
  app: {
    id: 'app-basic-id',
    mode: 'chat' as const,
    icon_type: 'emoji',
    icon: '😀',
    icon_background: '#fff',
    icon_url: '',
    name: 'Learn Dify App',
  },
  can_trial: true,
  app_id: 'learn-dify-app',
  description: 'Learn Dify description',
  categories: ['Writing'],
  position: 1,
  ...overrides,
})

describe('LearnDifyItem', () => {
  const mockTrackEvent = vi.mocked(trackEvent)

  beforeEach(() => {
    deploymentEdition = 'CLOUD'
    vi.clearAllMocks()
    onTestFinished(guardUnexpectedFetch())
  })

  it('activates the Community creation action from the keyboard', async () => {
    deploymentEdition = 'COMMUNITY'
    const app = createApp()
    const onCreate = vi.fn()

    const screen = await render(
      <LearnDifyItem canCreate item={app} onCreate={onCreate} onTry={vi.fn()} />,
    )

    const card = screen.getByRole('button', { name: 'Learn Dify App' })
    await userEvent.tab()
    await expect.element(card).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    expect(onCreate).toHaveBeenCalledWith(app)
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('keeps unavailable Community cards out of the native tab order', async () => {
    deploymentEdition = 'COMMUNITY'

    const screen = await render(
      <>
        <LearnDifyItem canCreate={false} item={createApp()} onTry={vi.fn()} />
        <button type="button">After catalog</button>
      </>,
    )

    await expect.element(screen.getByRole('heading', { name: 'Learn Dify App' })).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Learn Dify App' }))
      .not.toBeInTheDocument()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'After catalog' })).toHaveFocus()
  })

  it('describes the Cloud preview action and activates it with native Space', async () => {
    const onTry = vi.fn()
    const app = createApp()

    const screen = await render(<LearnDifyItem canCreate={false} item={app} onTry={onTry} />)

    const card = screen.getByRole('button', { name: 'Learn Dify App' })
    await expect.element(card).toHaveAccessibleDescription('Learn Dify description')
    await userEvent.tab()
    await expect.element(card).toHaveFocus()
    await userEvent.keyboard(' ')

    expect(onTry).toHaveBeenCalledWith(app)
    expect(mockTrackEvent).toHaveBeenCalledWith('preview_template', {
      template_id: app.app_id,
      template_name: app.app?.name,
      template_mode: app.app?.mode,
      template_categories: app.categories,
      page: 'explore',
    })
  })

  it('keeps nullable catalog metadata raw when previewing a card', async () => {
    const app: RecommendedAppResponse = {
      app_id: 'nullable-app',
      app: null,
      can_trial: true,
      description: null,
    }
    const onTry = vi.fn()

    const screen = await render(<LearnDifyItem canCreate={false} item={app} onTry={onTry} />)
    await screen.getByRole('button').click()

    expect(onTry).toHaveBeenCalledWith(app)
    expect(mockTrackEvent).toHaveBeenCalledWith('preview_template', {
      template_id: 'nullable-app',
      template_name: '',
      template_mode: '',
      template_categories: [],
      page: 'explore',
    })
  })
})
