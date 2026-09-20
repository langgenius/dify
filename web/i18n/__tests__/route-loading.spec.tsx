import { createToast, createToastManager } from '@langgenius/dify-ui/toast'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { AppToastHost } from '@/app/notifications/host'
import { changeLanguage } from '../client'
import { getDeclaredRouteNamespaces, getRouteNamespaces } from '../route-namespaces'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ pathname: '/signin', loadResource: vi.fn() }))
vi.mock('@/next/navigation', () => ({ usePathname: () => mocks.pathname }))
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

  it('preserves global notifications across namespace changes, including suspended navigation', async () => {
    const manager = createToastManager()
    const toast = createToast(manager)
    const content = () => (
      <I18nClientProvider locale="en-US" resource={{ 'en-US': resources['en-US'] }}>
        <AppToastHost manager={manager} timeout={0} />
        <Label />
      </I18nClientProvider>
    )
    const view = render(content())
    await screen.findByText('Save / Cancel')
    act(() => {
      toast.success('Still relevant after navigation')
    })
    await screen.findByText('Still relevant after navigation')

    let finishLoading!: () => void
    const pending = new Promise<void>((resolve) => {
      finishLoading = resolve
    })
    mocks.loadResource.mockImplementation(async () => {
      await pending
      return { default: {} }
    })
    mocks.pathname = '/apps'
    view.rerender(content())
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalled())
    await act(async () => {
      finishLoading()
      await pending
    })
    expect(await screen.findByText('Still relevant after navigation')).toBeVisible()

    mocks.pathname = '/signin'
    view.rerender(content())
    expect(await screen.findByText('Still relevant after navigation')).toBeVisible()
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
