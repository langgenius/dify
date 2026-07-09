import type { App } from '@/models/explore'
import { fireEvent, render, screen } from '@testing-library/react'
import { trackEvent } from '@/app/components/base/amplitude'
import { AppModeEnum } from '@/types/app'
import LearnDifyItem from '../item'

const mockConfig = vi.hoisted(() => ({
  isCloudEdition: true,
}))

vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>()
  return {
    ...actual,
    get IS_CLOUD_EDITION() {
      return mockConfig.isCloudEdition
    },
  }
})

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

const createApp = (overrides: Partial<App> = {}): App => ({
  app: {
    id: overrides.app?.id ?? 'app-basic-id',
    mode: overrides.app?.mode ?? AppModeEnum.CHAT,
    icon_type: overrides.app?.icon_type ?? 'emoji',
    icon: overrides.app?.icon ?? '😀',
    icon_background: overrides.app?.icon_background ?? '#fff',
    icon_url: overrides.app?.icon_url ?? '',
    name: overrides.app?.name ?? 'Learn Dify App',
    description: overrides.app?.description ?? 'Learn Dify description',
    use_icon_as_answer_icon: overrides.app?.use_icon_as_answer_icon ?? false,
  },
  can_trial: overrides.can_trial ?? true,
  app_id: overrides.app_id ?? 'learn-dify-app',
  description: overrides.description ?? 'Learn Dify description',
  copyright: overrides.copyright ?? '',
  privacy_policy: overrides.privacy_policy ?? null,
  custom_disclaimer: overrides.custom_disclaimer ?? null,
  categories: overrides.categories ?? ['Writing'],
  position: overrides.position ?? 1,
  is_listed: overrides.is_listed ?? true,
  install_count: overrides.install_count ?? 0,
  installed: overrides.installed ?? false,
  editable: overrides.editable ?? false,
  is_agent: overrides.is_agent ?? false,
})

describe('LearnDifyItem', () => {
  const mockTrackEvent = vi.mocked(trackEvent)

  beforeEach(() => {
    mockConfig.isCloudEdition = true
    vi.clearAllMocks()
  })

  it('should not render hover action buttons', () => {
    render(
      <LearnDifyItem
        canCreate
        item={createApp()}
        onCreate={vi.fn()}
        onTry={vi.fn()}
      />,
    )

    expect(screen.queryByText('explore.appCard.addToWorkspace')).not.toBeInTheDocument()
    expect(screen.queryByText('explore.appCard.try')).not.toBeInTheDocument()
  })

  it('should create app when card is clicked outside cloud edition', () => {
    mockConfig.isCloudEdition = false
    const app = createApp()
    const onCreate = vi.fn()

    render(
      <LearnDifyItem
        canCreate
        item={app}
        onCreate={onCreate}
        onTry={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Learn Dify App' }))

    expect(onCreate).toHaveBeenCalledWith(app)
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('should not make the card clickable outside cloud edition when create is unavailable', () => {
    mockConfig.isCloudEdition = false

    render(
      <LearnDifyItem
        canCreate={false}
        item={createApp()}
        onTry={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Learn Dify App' })).not.toBeInTheDocument()
  })

  it('should open detail when card is clicked in cloud edition', () => {
    const onTry = vi.fn()
    const app = createApp()

    render(
      <LearnDifyItem
        canCreate={false}
        item={app}
        onTry={onTry}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Learn Dify App' }))

    expect(onTry).toHaveBeenCalledWith({ appId: app.app_id, app })
    expect(mockTrackEvent).toHaveBeenCalledWith('preview_template', {
      template_id: app.app_id,
      template_name: app.app.name,
      template_mode: app.app.mode,
      template_categories: app.categories,
      page: 'explore',
    })
  })

  it('should run the card action when Enter is pressed', () => {
    const onTry = vi.fn()
    const app = createApp()

    render(
      <LearnDifyItem
        canCreate={false}
        item={app}
        onTry={onTry}
      />,
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'Learn Dify App' }), { key: 'Enter' })

    expect(onTry).toHaveBeenCalledWith({ appId: app.app_id, app })
  })
})
