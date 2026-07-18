import type { App } from '@/models/explore'
import type { AppIconType } from '@/types/app'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { trackEvent } from '@/app/components/base/amplitude'
import AppListContext from '@/context/app-list-context'
import { AppModeEnum } from '@/types/app'
import AppCard from '../index'

vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

const mockConfig = vi.hoisted(() => ({ isCloudEdition: true }))
vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get IS_CLOUD_EDITION() {
    return mockConfig.isCloudEdition
  },
}))

const app: App = {
  can_trial: true,
  app: {
    id: 'app-1',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji' as AppIconType,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_url: '',
    name: 'Chat template',
    description: 'Template description',
    use_icon_as_answer_icon: false,
  },
  app_id: 'app-1',
  description: 'Template description',
  copyright: 'Dify',
  privacy_policy: null,
  custom_disclaimer: null,
  categories: ['Assistant'],
  position: 1,
  is_listed: true,
  install_count: 100,
  installed: false,
  editable: true,
  is_agent: false,
}

describe('AppCard', () => {
  beforeEach(() => {
    mockConfig.isCloudEdition = true
    vi.clearAllMocks()
  })

  it('exposes template creation only when creation is allowed', () => {
    const { rerender } = render(<AppCard app={app} canCreate onCreate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'app.newApp.useTemplate' })).toBeInTheDocument()

    rerender(<AppCard app={app} canCreate={false} onCreate={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'app.newApp.useTemplate' })).not.toBeInTheDocument()
  })

  it('creates the template from the primary action', async () => {
    const onCreate = vi.fn()
    render(<AppCard app={app} canCreate onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: 'app.newApp.useTemplate' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it('uses the remote image URL for image icons', () => {
    render(
      <AppCard
        app={{
          ...app,
          app: {
            ...app.app,
            icon_type: 'image',
            icon: 'local.png',
            icon_url: 'https://example.com/remote.png',
          },
        }}
        canCreate
        onCreate={vi.fn()}
      />,
    )
    expect(screen.getByRole('img', { name: 'app icon' })).toHaveAttribute(
      'src',
      'https://example.com/remote.png',
    )
  })

  it('tracks and opens template preview in Cloud edition', async () => {
    const openPreview = vi.fn()
    render(
      // oxlint-disable-next-line eslint-react/no-context-provider
      <AppListContext.Provider
        value={{
          currentApp: undefined,
          isShowTryAppPanel: false,
          setShowTryAppPanel: openPreview,
          controlHideCreateFromTemplatePanel: 0,
        }}
      >
        <AppCard app={app} canCreate onCreate={vi.fn()} />
      </AppListContext.Provider>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'explore.appCard.try' }))

    expect(trackEvent).toHaveBeenCalledWith(
      'preview_template',
      expect.objectContaining({ template_id: 'app-1', page: 'studio' }),
    )
    expect(openPreview).toHaveBeenCalledWith(true, { appId: 'app-1', app })
  })
})
