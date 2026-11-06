import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { CreateAppRoute } from '../create-app-route'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useRouter: () => router,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'explore.apps.get': async () => ({ recommended_apps: [], categories: [] }),
    }),
  }
})

function renderRoute(searchParams: string, options: ConsoleQueryTestOptions = {}) {
  const queryClient = createConsoleQueryClient()
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  renderWithConsoleQuery(
    <JotaiProvider store={store}>
      <NuqsTestingAdapter searchParams={searchParams}>
        <CreateAppRoute />
      </NuqsTestingAdapter>
    </JotaiProvider>,
    {
      queryClient,
      accountProfile: { id: 'creator-1' },
      features: {},
      workspacePermissionKeys: ['app.create_and_management'],
      ...options,
    },
  )
  return { user: userEvent.setup() }
}

beforeEach(() => {
  router.push.mockReset()
  router.replace.mockReset()
})

it('opens blank creation with the app type from the URL', async () => {
  renderRoute('?mode=workflow')
  const dialog = await screen.findByRole('dialog', { name: 'app.newApp.startFromBlank' })
  expect(
    within(dialog).getByRole('heading', { name: 'app.types.workflow', level: 4 }),
  ).toBeInTheDocument()
})

it('returns to the Studio on close', async () => {
  const { user } = renderRoute('')
  const dialog = await screen.findByRole('dialog', { name: 'app.newApp.startFromBlank' })
  await user.click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/apps'))
})

it('switches between blank creation and templates in place', async () => {
  const { user } = renderRoute('')
  const blank = await screen.findByRole('dialog', { name: 'app.newApp.startFromBlank' })
  await user.click(within(blank).getByRole('button', { name: /app.newApp.noIdeaTip/ }))
  const templates = await screen.findByRole('dialog', { name: 'app.newApp.startFromTemplate' })
  expect(router.replace).not.toHaveBeenCalled()

  await user.click(
    await within(templates).findByRole('button', { name: /app.newApp.startFromBlank/ }),
  )
  expect(
    await screen.findByRole('dialog', { name: 'app.newApp.startFromBlank' }),
  ).toBeInTheDocument()
})

it('sends users without creation permission back to the Studio', async () => {
  renderRoute('?mode=workflow', { workspacePermissionKeys: [] })
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/apps'))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
