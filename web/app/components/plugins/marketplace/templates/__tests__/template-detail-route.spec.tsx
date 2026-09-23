import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import { TemplateDetailRouteProvider } from '../template-detail-route'
import { useOptionalTemplateDetailRoute } from '../use-optional-template-detail-route'

const deploymentState = vi.hoisted(() => ({
  deploymentEdition: 'CLOUD' as 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE',
}))

vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')
  return createSystemFeaturesStateModuleMock(() => deploymentState)
})

const id = 'c558a1fb-bb8c-4a5e-9404-d681c6659cf2'

const template: MarketplaceTemplate = {
  id,
  template_name: 'Campaign planner',
  overview: 'Plan a launch campaign.',
  icon: '📄',
  icon_background: '#fff',
  icon_file_key: '',
  publisher_unique_handle: 'dify',
  usage_count: 1200,
  categories: ['marketing'],
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('../template-detail-dialog', () => ({
  default: ({
    open,
    template: current,
    onOpenChange,
  }: {
    open: boolean
    template: MarketplaceTemplate
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role="dialog" aria-label={`${current.template_name} details`}>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close
        </button>
      </div>
    ) : null,
}))

function OpenButton() {
  const route = useOptionalTemplateDetailRoute()
  return (
    <button type="button" onClick={() => route?.open(template)}>
      Open template
    </button>
  )
}

describe('TemplateDetailRouteProvider', () => {
  beforeEach(() => {
    deploymentState.deploymentEdition = 'CLOUD'
    window.history.replaceState(window.history.state, '', '/templates')
  })

  it('opens the dialog when the templates URL names a template', () => {
    window.history.replaceState(window.history.state, '', `/templates/dify/${id}`)
    render(
      <TemplateDetailRouteProvider initialSelection={{ publisher: 'dify', id }}>
        <span>catalog</span>
      </TemplateDetailRouteProvider>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('writes /templates/{publisher}/{uuid} when a template opens and restores /templates on close', async () => {
    const user = userEvent.setup()
    render(
      <TemplateDetailRouteProvider>
        <OpenButton />
      </TemplateDetailRouteProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Open template' }))

    expect(window.location.pathname).toBe(`/templates/dify/${id}`)
    expect(screen.getByRole('dialog', { name: 'Campaign planner details' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(window.location.pathname).toBe('/templates')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('restores the category catalog URL when the dialog was opened from it', async () => {
    const user = userEvent.setup()
    window.history.replaceState(window.history.state, '', '/templates/marketing')
    render(
      <TemplateDetailRouteProvider>
        <OpenButton />
      </TemplateDetailRouteProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Open template' }))
    expect(window.location.pathname).toBe(`/templates/dify/${id}`)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(window.location.pathname).toBe('/templates/marketing')
  })
  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'replaces a legacy %s template detail URL with its official detail',
    (edition) => {
      deploymentState.deploymentEdition = edition
      window.history.replaceState(window.history.state, '', `/templates/dify/${id}`)
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      render(
        <TemplateDetailRouteProvider initialSelection={{ publisher: 'dify', id }}>
          <span>catalog</span>
        </TemplateDetailRouteProvider>,
      )
      expect(replace).toHaveBeenCalledOnce()
      const url = new URL(replace.mock.calls[0]![0])
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe(`/template/dify/${id}`)
      expect(url.searchParams.get('source')).toBe(window.location.origin)
      expect(url.searchParams.has('view')).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      replace.mockRestore()
    },
  )
})
