import type { ComponentProps } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import {
  appAccessErrorAtom,
  appAccessStore,
  captureAppAccessScope,
  isAppAccessError,
} from '@/features/app-access-error/state'
import enCommon from '@/i18n/en-US/common.json'
import enShare from '@/i18n/en-US/share.json'
import TryApp from '../index'

vi.unmock('react-i18next')
vi.mock('@/next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('../app', () => ({ default: () => null }))
vi.mock('../preview', () => ({ default: () => null }))
vi.mock('../app-info', () => ({ default: () => null }))
vi.mock('@langgenius/dify-ui/toast', () => ({ toast: { error: vi.fn() } }))

it('shows the unified error inside a dismissible trial dialog, retaining the parent page', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common: enCommon } },
  })
  window.history.replaceState({}, '', '/explore/apps')
  captureAppAccessScope()
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ code: 'app_not_found', message: 'App not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: (count, error) => !isAppAccessError(error) && count < 3 } },
  })
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <p>Explore apps</p>
        <TryApp
          appId="missing"
          app={{ can_trial: true } as ComponentProps<typeof TryApp>['app']}
          onClose={onClose}
          onCreate={vi.fn()}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  )
  expect(
    await screen.findByRole('heading', { name: enShare['appNotAccessible.title'] }),
  ).toBeInTheDocument()
  expect(screen.getByText('Explore apps')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledOnce()
  expect(toast.error).not.toHaveBeenCalled()
  expect(appAccessStore.get(appAccessErrorAtom)).toBeNull()
  await user.click(screen.getByRole('button', { name: enCommon['operation.close'] }))
  expect(onClose).toHaveBeenCalledOnce()
  queryClient.clear()
  vi.restoreAllMocks()
})
