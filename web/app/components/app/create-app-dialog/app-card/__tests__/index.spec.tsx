import type { RecommendedAppResponse } from '@dify/contracts/api/console/explore/types.gen'
import type { ReactElement } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trackEvent } from '@/app/components/base/amplitude'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppModeEnum } from '@/types/app'
import AppCard from '../index'

vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

const render = (ui: ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: 'CLOUD' } })

const app = {
  can_trial: true,
  app: {
    id: 'app-1',
    mode: AppModeEnum.CHAT,
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_url: '',
    name: 'Chat template',
  },
  app_id: 'app-1',
  description: 'Template description',
  copyright: 'Dify',
  privacy_policy: null,
  custom_disclaimer: null,
  categories: ['Assistant'],
  position: 1,
  is_listed: true,
} satisfies RecommendedAppResponse

describe('AppCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes template creation only when creation is allowed', () => {
    const { rerender } = render(
      <AppCard app={app} canCreate onCreate={vi.fn()} onPreview={vi.fn()} />,
    )
    expect(
      screen.getByRole('button', { name: 'app.newApp.useTemplate Chat template' }),
    ).toBeInTheDocument()

    rerender(<AppCard app={app} canCreate={false} onCreate={vi.fn()} onPreview={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: /^app\.newApp\.useTemplate/ }),
    ).not.toBeInTheDocument()
  })

  it('creates the template from the primary action', async () => {
    const onCreate = vi.fn()
    const user = userEvent.setup()
    render(<AppCard app={app} canCreate onCreate={onCreate} onPreview={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'app.newApp.useTemplate Chat template' }))
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
        onPreview={vi.fn()}
      />,
    )
    expect(screen.getByRole('img', { name: 'app icon' })).toHaveAttribute(
      'src',
      'https://example.com/remote.png',
    )
  })

  it('tracks and opens template preview in Cloud edition', async () => {
    const openPreview = vi.fn()
    const user = userEvent.setup()
    render(<AppCard app={app} canCreate onCreate={vi.fn()} onPreview={openPreview} />)

    await user.click(screen.getByRole('button', { name: 'explore.appCard.try Chat template' }))

    expect(trackEvent).toHaveBeenCalledWith(
      'preview_template',
      expect.objectContaining({ template_id: 'app-1', page: 'studio' }),
    )
    expect(openPreview).toHaveBeenCalledOnce()
  })

  it('allows creation and preview with nullable metadata without normalizing the selection', async () => {
    const nullableApp: RecommendedAppResponse = {
      app_id: 'nullable-app',
      app: null,
      can_trial: false,
      description: null,
    }
    const onCreate = vi.fn()
    const openPreview = vi.fn()
    const user = userEvent.setup()
    render(<AppCard app={nullableApp} canCreate onCreate={onCreate} onPreview={openPreview} />)

    await user.click(screen.getByRole('button', { name: 'app.newApp.useTemplate' }))
    expect(onCreate).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'explore.appCard.try' }))

    expect(openPreview).toHaveBeenCalledOnce()
    expect(trackEvent).toHaveBeenCalledWith('preview_template', {
      template_id: 'nullable-app',
      template_name: '',
      template_mode: '',
      template_categories: [],
      page: 'studio',
    })
  })
})
