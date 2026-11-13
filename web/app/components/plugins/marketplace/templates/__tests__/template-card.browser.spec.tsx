import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ThemeProvider } from '@/features/theme/provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import TemplateCard from '../template-card'
import { TemplateDetailRouteProvider } from '../template-detail-route'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
// boundary: the standalone browser page has no Next App Router.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push }) }))
// boundary: the external iframe document stays local; URL builders and the host dialog remain real.
vi.mock('@/features/marketplace/links', async (importOriginal) => {
  const { localMarketplaceFrameLinks } = await import('@/test/marketplace-frame-links')
  return localMarketplaceFrameLinks(
    await importOriginal<typeof import('@/features/marketplace/links')>(),
  )
})

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

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  const before = window.location.href
  onTestFinished(() => window.history.replaceState(null, '', before))
})

async function renderCard(edition: 'CLOUD' | 'COMMUNITY' | 'ENTERPRISE' = 'CLOUD', routed = false) {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  const card = <TemplateCard partnerText="Verified by a Dify partner" template={template} />
  return render(
    <ConsoleProvider>
      <ThemeProvider defaultPreference="dark">
        <div style={{ width: 320 }}>
          {routed ? <TemplateDetailRouteProvider>{card}</TemplateDetailRouteProvider> : card}
        </div>
      </ThemeProvider>
    </ConsoleProvider>,
  )
}

it('opens the real detail dialog before allowing its matching iframe message to import the template', async () => {
  const screen = await renderCard()
  const card = screen.getByRole('button', { name: 'Campaign planner' })
  await card.click()
  const dialog = screen.getByRole('dialog', { name: /Campaign planner/ })
  await expect.element(dialog).toBeVisible()
  expect(push).not.toHaveBeenCalled()
  const frame = screen.getByTitle('Campaign planner · plugin.detailPanel.operation.detail')
  await expect.element(frame).toBeVisible()
  const frameElement = frame.element() as HTMLIFrameElement
  expect(Object.fromEntries(new URL(frameElement.src).searchParams)).toEqual({
    language: 'en-US',
    source: window.location.origin,
    theme: 'dark',
    view: 'modal',
  })
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'dify-marketplace:install-template', templateId: 'another-template' },
      origin: 'null',
      source: frameElement.contentWindow,
    }),
  )
  expect(push).not.toHaveBeenCalled()
  await expect.element(dialog).toBeVisible()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'dify-marketplace:install-template', templateId: template.id },
      origin: 'null',
      source: frameElement.contentWindow,
    }),
  )
  expect(push).toHaveBeenCalledExactlyOnceWith('/apps?template-id=template%2Fone')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(card).toHaveFocus()
})

it('opens a routed template from the catalog using its real dialog', async () => {
  window.history.replaceState(null, '', '/templates')
  const screen = await renderCard('CLOUD', true)
  const card = screen.getByRole('button', { name: 'Campaign planner' })
  await card.click()
  await expect.poll(() => window.location.pathname).toBe('/templates/dify/template%2Fone')
  await expect.element(screen.getByRole('dialog', { name: /Campaign planner/ })).toBeVisible()
})

it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
  'keeps %s template links external and leaves the catalog URL unchanged',
  async (edition) => {
    window.history.replaceState(null, '', '/templates?q=research')
    const before = window.location.href
    const screen = await renderCard(edition, true)
    const link = screen.getByRole('link', { name: template.template_name })
    await expect.element(link).toBeVisible()
    const url = new URL(link.element().getAttribute('href')!)
    expect(url.origin).toBe('https://marketplace.dify.ai')
    expect(url.pathname).toBe('/template/dify/template%2Fone')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      source: window.location.origin,
      language: 'en-US',
      theme: 'dark',
    })
    await expect.element(link).toHaveAttribute('target', '_blank')
    await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer')
    // Native keyboard focus proves the real link remains operable without opening a remote document.
    await userEvent.tab()
    await expect.element(link).toHaveFocus()
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(window.location.href).toBe(before)
  },
)
