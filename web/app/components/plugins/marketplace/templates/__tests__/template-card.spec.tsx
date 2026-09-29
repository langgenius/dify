import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { Window } from 'happy-dom'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test'
import { render } from '@/test/console/render'
import TemplateCard from '../template-card'
import { TemplateDetailRouteProvider } from '../template-detail-route'

const deploymentState = vi.hoisted(() => ({
  deploymentEdition: 'CLOUD' as 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE',
}))

vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')
  return createSystemFeaturesStateModuleMock(() => deploymentState)
})

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  MARKETPLACE_URL_PREFIX: 'https://marketplace.example.com',
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div aria-hidden />,
}))

const template: MarketplaceTemplate = {
  id: 'template/one',
  template_name: 'Campaign planner',
  overview: 'Plan a launch campaign.',
  icon: '📄',
  icon_background: '#fff',
  icon_file_key: '',
  publisher_unique_handle: 'dify',
  usage_count: 1200,
  categories: ['marketing'],
  badges: ['partner'],
}

describe('TemplateCard', () => {
  const originalUrl = window.location.href
  const navigationSettings = (window as unknown as Window).happyDOM.settings.navigation
  const originalDisableChildFrameNavigation = navigationSettings.disableChildFrameNavigation

  beforeAll(() => {
    navigationSettings.disableChildFrameNavigation = true
  })

  beforeEach(() => {
    deploymentState.deploymentEdition = 'CLOUD'
    vi.clearAllMocks()
  })

  afterEach(() => {
    ;(window as unknown as Window).happyDOM.setURL(originalUrl)
  })

  afterAll(() => {
    navigationSettings.disableChildFrameNavigation = originalDisableChildFrameNavigation
  })

  it('opens template detail before starting the Dify import flow', async () => {
    const user = userEvent.setup()
    render(<TemplateCard partnerText="Verified by a Dify partner" template={template} />)

    expect(screen.queryByRole('link', { name: 'Campaign planner' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Campaign planner' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()

    const frame = screen.getByTitle(
      'Campaign planner · plugin.detailPanel.operation.detail',
    ) as HTMLIFrameElement
    const frameURL = new URL(frame.getAttribute('src')!, window.location.href)
    expect(frameURL.pathname).toBe('/template/dify/template%2Fone')
    expect(Object.fromEntries(frameURL.searchParams)).toEqual({
      language: 'en-US',
      source: window.location.origin,
      theme: 'dark',
      view: 'modal',
    })
    const marketplaceOrigin = frameURL.origin
    const installRequest = {
      type: 'dify-marketplace:install-template',
      templateId: template.id,
    }
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { ...installRequest, templateId: 'another-template' },
        origin: marketplaceOrigin,
        source: frame.contentWindow,
      }),
    )
    expect(mockPush).not.toHaveBeenCalled()

    fireEvent(
      window,
      new MessageEvent('message', {
        data: installRequest,
        origin: marketplaceOrigin,
        source: frame.contentWindow,
      }),
    )
    expect(mockPush).toHaveBeenCalledWith('/apps?template-id=template%2Fone')
    expect(screen.getByText('dify')).toBeInTheDocument()
    expect(screen.getByText('1.2k')).toBeInTheDocument()
    expect(screen.getByText('Verified by a Dify partner')).toBeInTheDocument()
  })

  it('syncs /templates/{publisher}/{uuid} while the routed detail dialog is open', async () => {
    window.history.replaceState(window.history.state, '', '/templates')
    const user = userEvent.setup()
    const routedTemplate = {
      ...template,
      id: 'c558a1fb-bb8c-4a5e-9404-d681c6659cf2',
    }
    render(
      <TemplateDetailRouteProvider>
        <TemplateCard partnerText="Verified by a Dify partner" template={routedTemplate} />
      </TemplateDetailRouteProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Campaign planner' }))

    expect(window.location.pathname).toBe(`/templates/dify/${routedTemplate.id}`)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'opens %s template links outside Dify without changing the catalog route',
    (edition) => {
      deploymentState.deploymentEdition = edition
      ;(window as unknown as Window).happyDOM.setURL(
        'https://ai.njueai.com:8443/templates?q=research',
      )
      const before = window.location.href
      render(
        <TemplateDetailRouteProvider>
          <TemplateCard partnerText="Partner" template={template} />
        </TemplateDetailRouteProvider>,
      )
      const link = screen.getByRole('link', { name: template.template_name })
      const url = new URL(link.getAttribute('href')!)
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe('/template/dify/template%2Fone')
      expect(Object.fromEntries(url.searchParams)).toEqual({
        source: window.location.origin,
        language: 'en-US',
        theme: 'dark',
      })
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(document.querySelector('iframe')).toBeNull()
      expect(window.location.href).toBe(before)
    },
  )
})
