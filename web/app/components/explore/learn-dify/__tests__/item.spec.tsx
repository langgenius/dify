import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trackEvent } from '@/app/components/base/amplitude'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import LearnDifyItem from '../item'

let deploymentEdition: DeploymentEdition = 'CLOUD'
const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: deploymentEdition } })

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const createApp = (overrides: Partial<RecommendedAppResponse> = {}): RecommendedAppResponse => ({
  app: {
    id: 'app-basic-id',
    mode: AppModeEnum.CHAT,
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
  })

  it('should not render hover action buttons', () => {
    render(<LearnDifyItem canCreate item={createApp()} onCreate={vi.fn()} onTry={vi.fn()} />)

    expect(screen.queryByText('explore.appCard.addToWorkspace')).not.toBeInTheDocument()
    expect(screen.queryByText('explore.appCard.try')).not.toBeInTheDocument()
  })

  it('should create app when card is clicked outside cloud edition', async () => {
    deploymentEdition = 'COMMUNITY'
    const app = createApp()
    const onCreate = vi.fn()
    const user = userEvent.setup()

    render(<LearnDifyItem canCreate item={app} onCreate={onCreate} onTry={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Learn Dify App' }))

    expect(onCreate).toHaveBeenCalledWith(app)
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('should not make the card clickable outside cloud edition when create is unavailable', () => {
    deploymentEdition = 'COMMUNITY'

    render(<LearnDifyItem canCreate={false} item={createApp()} onTry={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Learn Dify App' })).not.toBeInTheDocument()
  })

  it('should open detail when card is clicked in cloud edition', async () => {
    const onTry = vi.fn()
    const app = createApp()
    const user = userEvent.setup()

    render(<LearnDifyItem canCreate={false} item={app} onTry={onTry} />)

    await user.click(screen.getByRole('button', { name: 'Learn Dify App' }))

    expect(onTry).toHaveBeenCalledWith(app)
    expect(mockTrackEvent).toHaveBeenCalledWith('preview_template', {
      template_id: app.app_id,
      template_name: app.app?.name,
      template_mode: app.app?.mode,
      template_categories: app.categories,
      page: 'explore',
    })
  })

  it('should run the card action when Enter is pressed', async () => {
    const onTry = vi.fn()
    const app = createApp()
    const user = userEvent.setup()

    render(<LearnDifyItem canCreate={false} item={app} onTry={onTry} />)

    const card = screen.getByRole('button', { name: 'Learn Dify App' })
    expect(card).toHaveAttribute('type', 'button')
    expect(card).toHaveAccessibleDescription('Learn Dify description')

    card.focus()
    await user.keyboard('{Enter}')

    expect(onTry).toHaveBeenCalledWith(app)
  })

  it('keeps nullable catalog metadata raw when previewing a card', async () => {
    const app: RecommendedAppResponse = {
      app_id: 'nullable-app',
      app: null,
      can_trial: true,
      description: null,
    }
    const onTry = vi.fn()
    const user = userEvent.setup()

    render(<LearnDifyItem canCreate={false} item={app} onTry={onTry} />)
    await user.click(screen.getByRole('button'))

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
