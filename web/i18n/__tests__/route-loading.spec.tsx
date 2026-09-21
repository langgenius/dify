import type { ReactNode } from 'react'
import { createToast, createToastManager } from '@langgenius/dify-ui/toast'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, startTransition } from 'react'
import { renderToString } from 'react-dom/server'
import { useTranslation } from 'react-i18next'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { I18nServerProvider } from '@/app/components/provider/i18n-server'
import { AppToastHost } from '@/app/notifications/host'
import { changeLanguage } from '../client'
import { getDeclaredRouteNamespaces, getRouteNamespaces } from '../route-namespaces'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ pathname: '/signin', loadResource: vi.fn() }))
vi.mock('@/next/navigation', () => ({ usePathname: () => mocks.pathname }))
vi.mock('@/next/headers', () => ({
  headers: async () => new Headers({ 'x-dify-pathname': mocks.pathname }),
  cookies: async () => ({ get: () => ({ value: 'zh-Hans' }) }),
}))
vi.mock('../load-resource', () => ({ loadI18nResource: mocks.loadResource }))

const makeResources = () => ({
  'en-US': {
    common: { 'operation.save': 'Save', 'operation.cancel': 'Cancel' },
    login: { signBtn: 'Sign in' },
  },
  'zh-Hans': { common: { 'operation.save': '保存' }, login: { signBtn: '登录' } },
})
let resources = makeResources()
function Label() {
  const { t } = useTranslation()
  return (
    <span>
      {t(($) => $['operation.save'], { ns: 'common' })} /{' '}
      {t(($) => $['operation.cancel'], { ns: 'common' })}
    </span>
  )
}

describe('route translation loading', () => {
  beforeEach(() => {
    resources = makeResources()
    mocks.pathname = '/signin'
    mocks.loadResource.mockReset()
    mocks.loadResource.mockImplementation(
      async (locale: keyof typeof resources, namespace: string) => ({
        default: resources[locale]?.[namespace as 'common' | 'login'] ?? {},
      }),
    )
  })

  it('renders localized text and fallback without requesting missing unrelated namespaces', async () => {
    render(
      <I18nClientProvider locale="zh-Hans" resource={resources}>
        <Label />
      </I18nClientProvider>,
    )
    expect(await screen.findByText('保存 / Cancel')).toBeVisible()
    expect(mocks.loadResource).not.toHaveBeenCalled()
  })

  it('includes localized content and English fallback in an unmigrated route server response', async () => {
    mocks.pathname = '/agents/example/configure'
    const page = await I18nServerProvider({
      children: <Label />,
    })
    const html = renderToString(page)
    expect(html).toContain('保存')
    expect(html).toContain('Cancel')
  })

  it('loads only active namespaces when switching language and retains that language on rerender', async () => {
    const view = render(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Label />
      </I18nClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Save / Cancel')).toBeVisible())
    await act(() => changeLanguage('zh-Hans'))
    expect(await screen.findByText('保存 / Cancel')).toBeVisible()
    expect(mocks.loadResource.mock.calls.map(([, ns]) => ns).sort()).toEqual(['common', 'login'])
    view.rerender(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Label />
      </I18nClientProvider>,
    )
    expect(screen.getByText('保存 / Cancel')).toBeVisible()
  })

  it('loads unmigrated route resources on navigation, then scopes the next language change back to signin', async () => {
    const view = render(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Label />
      </I18nClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Save / Cancel')).toBeVisible())
    mocks.pathname = '/apps'
    view.rerender(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Label />
      </I18nClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Save / Cancel')).toBeVisible())
    expect(mocks.loadResource.mock.calls.map(([, ns]) => ns)).toContain('workflow')
    mocks.pathname = '/signin'
    view.rerender(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Label />
      </I18nClientProvider>,
    )
    mocks.loadResource.mockClear()
    await act(() => changeLanguage('zh-Hans'))
    expect(await screen.findByText('保存 / Cancel')).toBeVisible()
    expect(mocks.loadResource.mock.calls.map(([, ns]) => ns).sort()).toEqual(['common', 'login'])
  })

  it('retains committed content and shared state until destination translations are ready', async () => {
    function Destination() {
      const { t } = useTranslation('common')
      return <span>{t(($) => $['blocks.agent'], { ns: 'workflow' })}</span>
    }
    const user = userEvent.setup()
    const manager = createToastManager()
    const toast = createToast(manager)
    const content = () => (
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <AppToastHost manager={manager} timeout={0} />
        <input aria-label="Shared draft" />
        {mocks.pathname === '/signin' ? <Label /> : <Destination />}
      </I18nClientProvider>
    )
    const view = render(content())
    await screen.findByText('Save / Cancel')
    await user.type(screen.getByRole('textbox', { name: 'Shared draft' }), 'Keep me')
    act(() => {
      toast.success('Still relevant after navigation')
    })
    await screen.findByText('Still relevant after navigation')

    let finishLoading!: () => void
    const pending = new Promise<void>((resolve) => {
      finishLoading = resolve
    })
    mocks.loadResource.mockImplementation(async (_locale, namespace) => {
      await pending
      return { default: namespace === 'workflow' ? { 'blocks.agent': 'Agent' } : {} }
    })
    mocks.pathname = '/apps'
    startTransition(() => view.rerender(content()))
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalled())
    expect(screen.getByText('Save / Cancel')).toBeVisible()
    expect(screen.queryByText('blocks.agent')).not.toBeInTheDocument()
    expect(screen.getByText('Still relevant after navigation')).toBeVisible()
    await act(async () => {
      finishLoading()
      await pending
    })
    expect(await screen.findByText('Still relevant after navigation')).toBeVisible()
    expect(await screen.findByText('Agent')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Shared draft' })).toHaveValue('Keep me')

    mocks.pathname = '/signin'
    startTransition(() => view.rerender(content()))
    expect(await screen.findByText('Still relevant after navigation')).toBeVisible()
  })

  it('preserves route state when navigating within the same namespace scope', async () => {
    mocks.pathname = '/apps'
    const user = userEvent.setup()
    const content = () => (
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <input aria-label="Draft" />
      </I18nClientProvider>
    )
    const view = render(content())
    await user.type(await screen.findByRole('textbox', { name: 'Draft' }), 'Keep this draft')
    mocks.pathname = '/agents'
    startTransition(() => view.rerender(content()))
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep this draft')
  })

  it('keeps server-rendered navigation visible while a client module hydrates', async () => {
    let finishLoading!: () => void
    const pending = new Promise<{ default: () => ReactNode }>((resolve) => {
      finishLoading = () => resolve({ default: () => <main>Page content</main> })
    })
    const ClientPage = lazy(() => pending)
    const content = (page: ReactNode) => (
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <nav aria-label="App navigation">Navigation</nav>
        {page}
      </I18nClientProvider>
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(content(<main>Page content</main>))
    document.body.appendChild(container)
    const view = render(content(<ClientPage />), { container, hydrate: true })
    view.rerender(content(<ClientPage />))

    expect(screen.getByRole('navigation', { name: 'App navigation' })).toBeVisible()
    await act(async () => {
      finishLoading()
      await pending
    })
    expect(screen.getByRole('navigation', { name: 'App navigation' })).toBeVisible()
    expect(screen.getByRole('main')).toHaveTextContent('Page content')
  })

  it('matches signin segments with a base path and keeps unknown routes complete', () => {
    expect(getRouteNamespaces('/console/signin/check-code', '/console')).toEqual([
      'common',
      'login',
    ])
    expect(getDeclaredRouteNamespaces('/signin/check-code')).toEqual(['common', 'login'])
    expect(getDeclaredRouteNamespaces('/signin-other')).toBeUndefined()
    expect(getDeclaredRouteNamespaces('/datasets')).toBeUndefined()
    expect(getRouteNamespaces('/signin-other')).toContain('workflow')
    expect(getRouteNamespaces(null)).toContain('workflow')
  })
})
