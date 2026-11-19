import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { TemplateDetailRouteProvider } from '../template-detail-route'
import { useOptionalTemplateDetailRoute } from '../use-optional-template-detail-route'

// boundary: the standalone browser page has no Next App Router.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
// boundary: the remote iframe is a local document; host message handling and focus stay real.
vi.mock('@/features/marketplace/links', async (importOriginal) => {
  const { localMarketplaceFrameLinks } = await import('@/test/marketplace-frame-links')
  return localMarketplaceFrameLinks(
    await importOriginal<typeof import('@/features/marketplace/links')>(),
  )
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

function OpenButton() {
  const route = useOptionalTemplateDetailRoute()
  return (
    <button type="button" onClick={() => route?.open(template)}>
      Open template
    </button>
  )
}

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  const original = window.location.href
  onTestFinished(() => window.history.replaceState(null, '', original))
})

async function renderRoute(initialSelection?: { publisher: string; id: string }) {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  return render(
    <ConsoleProvider>
      <TemplateDetailRouteProvider initialSelection={initialSelection}>
        <OpenButton />
      </TemplateDetailRouteProvider>
    </ConsoleProvider>,
  )
}

it('opens the real iframe dialog for a template named by the initial URL', async () => {
  window.history.replaceState(null, '', `/templates/dify/${id}`)
  const screen = await renderRoute({ publisher: 'dify', id })
  const dialog = screen.getByRole('dialog', { name: 'dify · plugin.detailPanel.operation.detail' })
  await expect.element(dialog).toBeVisible()
  await expect.element(dialog.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
})

it.each(['/templates', '/templates/marketing'])(
  'returns from the real template dialog to %s',
  async (catalog) => {
    window.history.replaceState(null, '', catalog)
    const screen = await renderRoute()
    const open = screen.getByRole('button', { name: 'Open template' })
    await open.click()
    await expect.poll(() => window.location.pathname).toBe(`/templates/dify/${id}`)
    const dialog = screen.getByRole('dialog', { name: /Campaign planner/ })
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'common.operation.close' }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.poll(() => window.location.pathname).toBe(catalog)
    await expect.element(open).toHaveFocus()
  },
)
