import type { ReactNode } from 'react'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import ErrorBoundary from '../index'

vi.unmock('react-i18next')

function Content({ failed = true }: { failed?: boolean }) {
  if (failed) throw new Error('Render unavailable')
  return <div>Recovered content</div>
}

async function renderBoundary(ui: ReactNode) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en-US', resources: { 'en-US': { common } }, keySeparator: false })
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

beforeEach(() => {
  // boundary: React reports caught render errors to the console; keep expected failures quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

it('recovers the failed content when the user retries', async () => {
  function Recovery() {
    const [failed, setFailed] = useState(true)
    return (
      <ErrorBoundary showDetails={false} onReset={() => setFailed(false)}>
        <Content failed={failed} />
      </ErrorBoundary>
    )
  }
  await renderBoundary(<Recovery />)
  await expect.element(page.getByText('Something went wrong')).toBeVisible()
  await page.getByRole('button', { name: 'Try Again', exact: true }).click()
  await expect.element(page.getByText('Recovered content')).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'Try Again', exact: true }))
    .not.toBeInTheDocument()
})

it('renders custom recovery guidance and omits disabled recovery actions', async () => {
  await renderBoundary(
    <ErrorBoundary
      showDetails={false}
      enableRecovery={false}
      isolate={false}
      customTitle="Service unavailable"
      customMessage="Contact the workspace owner"
    >
      <Content />
    </ErrorBoundary>,
  )
  await expect.element(page.getByText('Service unavailable')).toBeVisible()
  await expect.element(page.getByText('Contact the workspace owner')).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: /Try Again|Reload Page/ }))
    .not.toBeInTheDocument()
})

it('reports a caught render failure to the embedding owner', async () => {
  const onError = vi.fn()
  await renderBoundary(
    <ErrorBoundary showDetails={false} onError={onError}>
      <Content />
    </ErrorBoundary>,
  )
  await expect.element(page.getByText('Something went wrong')).toBeVisible()
  expect(onError).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: 'Render unavailable' }),
    expect.objectContaining({ componentStack: expect.any(String) }),
  )
})

it('makes diagnostic details available when requested', async () => {
  await renderBoundary(
    <ErrorBoundary showDetails>
      <Content />
    </ErrorBoundary>,
  )
  const details = page.getByText('Error Details (Development Only)')
  await expect.element(details).toBeVisible()
  await details.click()
  await expect.element(page.getByText('Error: Render unavailable', { exact: true })).toBeVisible()
})

it('can recover through a custom fallback action', async () => {
  function CustomRecovery() {
    const [failed, setFailed] = useState(true)
    return (
      <ErrorBoundary
        onReset={() => setFailed(false)}
        fallback={(error, reset) => (
          <section aria-label="Recovery">
            <p>{error.message}</p>
            <button type="button" onClick={reset}>
              Reconnect
            </button>
          </section>
        )}
      >
        <Content failed={failed} />
      </ErrorBoundary>
    )
  }
  await renderBoundary(<CustomRecovery />)
  await expect
    .element(page.getByRole('region', { name: 'Recovery' }))
    .toHaveTextContent('Render unavailableReconnect')
  await page.getByRole('button', { name: 'Reconnect' }).click()
  await expect.element(page.getByText('Recovered content')).toBeVisible()
})

it('keeps caller-provided static fallback content available', async () => {
  await renderBoundary(
    <ErrorBoundary fallback={<a href="/support">Get support</a>}>
      <Content />
    </ErrorBoundary>,
  )
  await expect
    .element(page.getByRole('link', { name: 'Get support' }))
    .toHaveAttribute('href', '/support')
})

it('recovers when the caller changes the reset key, while equal key values preserve the failure', async () => {
  function KeyedRecovery() {
    const [key, setKey] = useState(0)
    const [failed, setFailed] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setFailed(false)}>
          Retry data with same key
        </button>
        <button type="button" onClick={() => setKey(1)}>
          Switch resource
        </button>
        <ErrorBoundary showDetails={false} resetKeys={[key]}>
          <Content failed={failed} />
        </ErrorBoundary>
      </>
    )
  }
  await renderBoundary(<KeyedRecovery />)
  await expect.element(page.getByText('Something went wrong')).toBeVisible()
  await page.getByRole('button', { name: 'Retry data with same key' }).click()
  await expect.element(page.getByText('Something went wrong')).toBeVisible()
  await expect.element(page.getByText('Recovered content')).not.toBeInTheDocument()
  await page.getByRole('button', { name: 'Switch resource' }).click()
  await expect.element(page.getByText('Recovered content')).toBeVisible()
})

it.each([[], undefined, ['first']])(
  'recovers when the embedding owner removes reset keys (%s)',
  async (resetKeys) => {
    function ResetKeys() {
      const [removed, setRemoved] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setRemoved(true)}>
            Remove resource
          </button>
          <ErrorBoundary showDetails={false} resetKeys={removed ? resetKeys : ['first', 'second']}>
            <Content failed={!removed} />
          </ErrorBoundary>
        </>
      )
    }
    await renderBoundary(<ResetKeys />)
    await expect.element(page.getByText('Something went wrong')).toBeVisible()
    await page.getByRole('button', { name: 'Remove resource' }).click()
    await expect.element(page.getByText('Recovered content')).toBeVisible()
  },
)

it('recovers when the caller replaces failed children and enables prop-based reset', async () => {
  function ReplaceChildren() {
    const [replaced, setReplaced] = useState(false)
    return (
      <>
        <button type="button" onClick={() => setReplaced(true)}>
          Replace content
        </button>
        <ErrorBoundary showDetails={false} resetOnPropsChange>
          {replaced ? <div>Replacement content</div> : <Content />}
        </ErrorBoundary>
      </>
    )
  }
  await renderBoundary(<ReplaceChildren />)
  await expect.element(page.getByText('Something went wrong')).toBeVisible()
  await page.getByRole('button', { name: 'Replace content' }).click()
  await expect.element(page.getByText('Replacement content')).toBeVisible()
})
