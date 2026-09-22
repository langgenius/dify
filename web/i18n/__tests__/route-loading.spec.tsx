import type { ReactNode } from 'react'
import { createToast, createToastManager } from '@langgenius/dify-ui/toast'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { lazy, startTransition, Suspense, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { useTranslation } from 'react-i18next'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { I18nServerProvider } from '@/app/components/provider/i18n-server'
import { AppToastHost } from '@/app/notifications/host'
import { changeLanguage } from '../client'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ pathname: '/signin', loadResource: vi.fn() }))
vi.mock('@/next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => ({ value: 'zh-Hans' }) }),
}))
vi.mock('../load-resource', () => ({ loadI18nResource: mocks.loadResource }))

const makeResources = () => ({
  'en-US': {
    common: { 'operation.save': 'Save', 'operation.cancel': 'Cancel' },
  },
  'zh-Hans': { common: { 'operation.save': '保存' } },
})
let resources = makeResources()
function Label() {
  const { t } = useTranslation(['common'])
  return (
    <span>
      {t(($) => $['operation.save'], { ns: 'common' })} /{' '}
      {t(($) => $['operation.cancel'], { ns: 'common' })}
    </span>
  )
}

function Destination() {
  const { t } = useTranslation(['workflow'])
  return <span>{t(($) => $['blocks.agent'], { ns: 'workflow' })}</span>
}

describe('on-demand translation loading', () => {
  beforeEach(() => {
    resources = makeResources()
    mocks.pathname = '/signin'
    mocks.loadResource.mockReset()
    mocks.loadResource.mockImplementation(
      async (locale: keyof typeof resources, namespace: string) => ({
        default: resources[locale]?.[namespace as 'common'] ?? {},
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

  it('starts the root provider without preloading and loads common only when rendered', async () => {
    const page = await I18nServerProvider({
      children: (
        <Suspense fallback={<span>Loading</span>}>
          <Label />
        </Suspense>
      ),
    })
    expect(mocks.loadResource).not.toHaveBeenCalled()
    render(page)
    expect(await screen.findByText('保存 / Cancel')).toBeVisible()
    expect(mocks.loadResource.mock.calls.map(([lng, ns]) => `${lng}/${ns}`).sort()).toEqual([
      'en-US/common',
      'zh-Hans/common',
    ])
  })

  it('switches language for requested namespaces and retains it on rerender', async () => {
    const view = render(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Label />
      </I18nClientProvider>,
    )
    await waitFor(() => expect(screen.getByText('Save / Cancel')).toBeVisible())
    await act(() => changeLanguage('zh-Hans'))
    expect(await screen.findByText('保存 / Cancel')).toBeVisible()
    expect(mocks.loadResource.mock.calls.map(([, ns]) => ns).sort()).toEqual(['common'])
    view.rerender(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Label />
      </I18nClientProvider>,
    )
    expect(screen.getByText('保存 / Cancel')).toBeVisible()
  })

  it('loads destination namespaces on navigation without requesting unrelated features', async () => {
    mocks.loadResource.mockImplementation(async (locale, namespace) => ({
      default:
        namespace === 'workflow'
          ? { 'blocks.agent': locale === 'en-US' ? 'Agent' : '代理' }
          : (resources[locale as keyof typeof resources]?.common ?? {}),
    }))
    const content = (destination = false) => (
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        {destination ? <Destination /> : <Label />}
      </I18nClientProvider>
    )
    const view = render(content())
    await screen.findByText('Save / Cancel')
    startTransition(() => view.rerender(content(true)))
    expect(await screen.findByText('Agent')).toBeVisible()
    expect(mocks.loadResource.mock.calls.map(([, ns]) => ns)).toEqual(['workflow'])
    startTransition(() => view.rerender(content()))
    await screen.findByText('Save / Cancel')
    mocks.loadResource.mockClear()
    await act(() => changeLanguage('zh-Hans'))
    expect(await screen.findByText('保存 / Cancel')).toBeVisible()
    // i18next retains requested namespaces for subsequent language changes.
    expect(mocks.loadResource.mock.calls.map(([, ns]) => ns).sort()).toEqual(['common', 'workflow'])
  })

  it('loads an optional feature only when opened and keeps the shell visible while loading', async () => {
    let finishLoading!: () => void
    const pending = new Promise<void>((resolve) => {
      finishLoading = resolve
    })
    mocks.loadResource.mockImplementation(async () => {
      await pending
      return { default: { 'blocks.agent': 'Agent' } }
    })
    function Page() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Label />
          <button onClick={() => setOpen(true)}>Open editor</button>
          <Suspense fallback={<span>Loading editor</span>}>{open && <Destination />}</Suspense>
        </>
      )
    }
    const user = userEvent.setup()
    render(
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <Page />
      </I18nClientProvider>,
    )
    expect(mocks.loadResource).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Open editor' }))
    expect(screen.getByText('Save / Cancel')).toBeVisible()
    expect(screen.getByText('Loading editor')).toBeVisible()
    expect(screen.queryByText('blocks.agent')).not.toBeInTheDocument()
    await act(async () => {
      finishLoading()
      await pending
    })
    expect(await screen.findByText('Agent')).toBeVisible()
    expect(mocks.loadResource).toHaveBeenCalledExactlyOnceWith('en-US', 'workflow')
  })

  it('retains committed content and shared state until destination translations are ready', async () => {
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
})
