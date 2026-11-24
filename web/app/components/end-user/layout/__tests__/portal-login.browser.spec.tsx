import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { apiError, hold, route, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import { createTestQueryClient } from '@/test/query-client'
import EndUserLayout from '..'

const fake = setupFakeApi({
  routes: [
    route('POST', 'public', '/account/session', () => ({ result: 'success' })),
    route('GET', 'public', '/account/profile', () => {
      throw apiError({ status: 401, message: 'Sign-in required' })
    }),
  ],
})

it('waits to open My apps until the Webapp cookie works and lets the user retry if it was rejected', async () => {
  const returnPath = '/my-apps'
  const callbackPath = `${returnPath}?login_code=one-use-code`
  const originalUrl = window.location.href
  const client = createTestQueryClient()
  const transactionKey = 'webapp-portal-login'
  const verifier = 'v'.repeat(43)
  // Start at the Console callback with the pending login that the initiating tab kept.
  sessionStorage.setItem(
    transactionKey,
    JSON.stringify({
      verifier,
      redirectUrl: new URL(returnPath, originalUrl).href,
      createdAt: Date.now(),
    }),
  )
  window.history.replaceState({}, '', callbackPath)
  onTestFinished(() => {
    window.history.replaceState({}, '', originalUrl)
    sessionStorage.removeItem(transactionKey)
    client.clear()
  })

  const exchange = hold(fake.route('POST', 'public', '/account/session'))
  const profile = hold(fake.route('GET', 'public', '/account/profile'))
  const screen = await render(
    <QueryClientProvider client={client}>
      <EndUserLayout>
        <h1>My apps content</h1>
      </EndUserLayout>
    </QueryClientProvider>,
    { wrapper: createTestNavigation({ url: callbackPath }).NavigationProvider },
  )

  expect((await exchange.arrived).body).toEqual({
    login_code: 'one-use-code',
    code_verifier: verifier,
  })
  await expect
    .element(screen.getByRole('heading', { name: 'My apps content' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'app.endUser.myApps' }))
    .not.toBeInTheDocument()
  expect(fake.route('GET', 'public', '/account/profile')).not.toHaveBeenCalled()
  exchange.release()

  await profile.arrived
  await expect
    .element(screen.getByRole('heading', { name: 'My apps content' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'app.endUser.myApps' }))
    .not.toBeInTheDocument()
  profile.release()

  await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  await expect.element(screen.getByRole('button', { name: 'common.operation.retry' })).toBeVisible()
  expect(window.location.pathname + window.location.search).toBe(callbackPath)
  expect(fake.route('GET', 'public', '/account/profile')).toHaveBeenCalledOnce()
})
