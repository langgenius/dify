import type { App } from '@/models/explore'
import { fireEvent, render, screen } from '@testing-library/react'
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
  beforeEach(() => {
    mockConfig.isCloudEdition = true
    vi.clearAllMocks()
  })

  it('should hide try action outside cloud edition', () => {
    mockConfig.isCloudEdition = false

    render(
      <LearnDifyItem
        canCreate
        item={createApp()}
        onCreate={vi.fn()}
        onTry={vi.fn()}
      />,
    )

    expect(screen.getByText('explore.appCard.addToWorkspace')).toBeInTheDocument()
    expect(screen.queryByText('explore.appCard.try')).not.toBeInTheDocument()
  })

  it('should show try action in cloud edition', () => {
    const onTry = vi.fn()
    const app = createApp()

    render(
      <LearnDifyItem
        canCreate={false}
        item={app}
        onTry={onTry}
      />,
    )

    fireEvent.click(screen.getByText('explore.appCard.try'))

    expect(onTry).toHaveBeenCalledWith({ appId: app.app_id, app })
  })
})
