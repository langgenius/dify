import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Suspense, useState } from 'react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { changeLanguage } from '@/i18n/client'
import TryApp from '../index'

vi.unmock('react-i18next')
vi.mock('@/next/navigation', () => ({ usePathname: () => '/' }))
const mocks = vi.hoisted(() => ({ loadResource: vi.fn() }))
vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: mocks.loadResource }))
vi.mock('@/service/use-try-app', () => ({
  useGetTryAppInfo: () => ({ data: undefined, isLoading: false }),
}))
// Keep the real unavailable state, which consumes the deferred `share` namespace.
// Successful app/preview content is covered by the existing feature tests.
vi.mock('../app', () => ({ default: () => null }))
vi.mock('../preview', () => ({ default: () => null }))
vi.mock('../app-info', () => ({ default: () => null }))

function Home() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <input aria-label="Template search" />
      <button type="button" onClick={() => setOpen(true)}>
        Try template
      </button>
      <Suspense fallback={null}>
        {open && (
          <TryApp
            app={{ app_id: 'template', can_trial: true }}
            onClose={() => setOpen(false)}
            onCreate={() => {}}
          />
        )}
      </Suspense>
    </>
  )
}

it('loads template translations only on open, preserves home, and supports language changes and reopen', async () => {
  const user = userEvent.setup()
  let resolve!: () => void
  const pending = new Promise<void>((done) => {
    resolve = done
  })
  mocks.loadResource.mockImplementation(async (locale: string, namespace: string) => {
    await pending
    return {
      default:
        namespace === 'share'
          ? {
              'common.appUnknownError': locale === 'zh-Hans' ? '应用暂时不可用' : 'App unavailable',
            }
          : {},
    }
  })
  const resource = {
    'en-US': {
      app: {},
      common: { 'operation.close': 'Close' },
      explore: {},
      billing: {},
      skill: {},
      agentV2: {},
    },
  }
  render(
    <I18nClientProvider locale="en-US" resource={resource}>
      <Home />
    </I18nClientProvider>,
  )
  await user.type(screen.getByRole('textbox', { name: 'Template search' }), 'Keep my search')
  expect(mocks.loadResource).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Try template' }))
  await waitFor(() => expect(mocks.loadResource).toHaveBeenCalled())
  expect(screen.getByRole('textbox', { name: 'Template search' })).toHaveValue('Keep my search')
  expect(screen.queryByText('common.appUnknownError')).not.toBeInTheDocument()
  await act(async () => {
    resolve()
    await pending
  })
  expect(await screen.findByText('App unavailable')).toBeVisible()
  await act(() => changeLanguage('zh-Hans'))
  expect(await screen.findByText('应用暂时不可用')).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText('应用暂时不可用')).not.toBeInTheDocument())
  mocks.loadResource.mockClear()
  await user.click(screen.getByRole('button', { name: 'Try template' }))
  expect(await screen.findByText('应用暂时不可用')).toBeVisible()
  expect(mocks.loadResource).not.toHaveBeenCalled()
})
