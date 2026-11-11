import type { PersonalAccessTokenListResponse } from '@dify/contracts/api/console/account/types.gen'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'
import { firstPage, render, renderTokens, token } from './browser-test-env'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: transport }))
vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(1100, 800)
})

it('keeps the table and pagination in place while blocking stale rows during a page change', async () => {
  const first = createDeferred<PersonalAccessTokenListResponse>()
  const next = createDeferred<PersonalAccessTokenListResponse>()
  transport.call.mockImplementation(async (_path: string[], input: { query: { page: number } }) =>
    input.query.page === 1 ? first.promise : next.promise,
  )
  const screen = await renderTokens()
  const region = screen.getByRole('region', { name: 'Personal access tokens' })
  await expect.element(region).toBeVisible()
  const height = region.element().getBoundingClientRect().height
  first.resolve(firstPage)
  const table = region.getByRole('table')
  const pagination = region.getByRole('navigation', { name: 'Personal access tokens' })
  await expect.element(screen.getByRole('button', { name: 'Token 1', exact: true })).toBeVisible()
  await expect.element(pagination).toBeVisible()
  const paginationTop = pagination.element().getBoundingClientRect().top
  expect(region.element().getBoundingClientRect().height).toBe(height)
  await screen.getByRole('button', { name: 'Next', exact: true }).click()
  await expect.element(table).toHaveAttribute('aria-busy', 'true')
  await expect.element(screen.getByRole('status')).toHaveTextContent('Loading')
  await expect.element(screen.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Next', exact: true })).toHaveFocus()
  await expect.element(screen.getByRole('button', { name: '2/2: Edit page number' })).toBeDisabled()
  expect(region.element().getBoundingClientRect().height).toBe(height)
  const create = screen.getByRole('button', { name: 'Create token' })
  await expect.element(create).toBeVisible()
  create.element().focus()
  // Chromium includes the scrollable table viewport in the native Tab order.
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Previous', exact: true })).toHaveFocus()
  await expect
    .element(screen.getByRole('button', { name: 'Token 1', exact: true }))
    .not.toHaveFocus()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  next.resolve({ data: [token], page: 2, limit: 20, total: 21, has_more: false })
  await expect.element(screen.getByRole('button', { name: token.name, exact: true })).toBeVisible()
  await expect.element(table).toHaveAttribute('aria-busy', 'false')
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  expect(region.element().getBoundingClientRect().height).toBe(height)
  expect(pagination.element().getBoundingClientRect().top).toBe(paginationTop)
  await screen.getByRole('button', { name: 'Previous', exact: true }).click()
  await expect.element(screen.getByRole('button', { name: 'Token 1', exact: true })).toBeVisible()
})

it('uses the shared page jump to request a page and synchronize its URL', async () => {
  const lastPage = createDeferred<PersonalAccessTokenListResponse>()
  transport.call.mockImplementation(async (_path: string[], input: { query: { page: number } }) =>
    input.query.page === 1 ? { ...firstPage, total: 45 } : lastPage.promise,
  )
  const screen = await renderTokens()
  const pagination = screen.getByRole('navigation', { name: 'Personal access tokens' })
  await pagination.getByRole('button', { name: '1/3: Edit page number' }).click()
  await pagination.getByRole('textbox', { name: 'Page number' }).fill('3')
  await userEvent.keyboard('{Enter}')
  const summary = pagination.getByRole('button', { name: '3/3: Edit page number' })
  await expect.element(summary).toBeDisabled()
  await expect.element(summary).toHaveFocus()
  await expect.element(screen.getByRole('status')).toHaveTextContent('Loading')
  await vi.waitFor(() =>
    expect(screen.onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ queryString: '?patPage=3' }),
    ),
  )
  expect(transport.call.mock.calls.at(-1)?.[1].query.page).toBe(3)
  lastPage.resolve({ data: [token], page: 3, limit: 20, total: 45, has_more: false })
  await expect.element(screen.getByRole('button', { name: token.name, exact: true })).toBeVisible()
  await expect.element(summary).toBeEnabled()
  await expect.element(pagination.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
})

it('recovers from an out-of-range token page in the URL', async () => {
  transport.call.mockImplementation(async (_path: string[], input: { query: { page: number } }) => {
    const current = input.query.page
    return {
      ...firstPage,
      data: current === 1 ? firstPage.data : [],
      page: current,
      total: firstPage.data.length,
      has_more: false,
    } satisfies PersonalAccessTokenListResponse
  })

  const screen = await renderTokens('?patPage=2')
  await expect.element(screen.getByRole('button', { name: 'Token 1', exact: true })).toBeVisible()
  await vi.waitFor(() =>
    expect(screen.onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '',
        options: expect.objectContaining({ history: 'replace' }),
      }),
    ),
  )
})

it('returns to the previous page after deleting the last token on a deep-linked final page', async () => {
  let deleted = false
  const pages: number[] = []
  transport.call.mockImplementation(async (path: string[], input: { query?: { page: number } }) => {
    if (path.at(-1) === 'delete') {
      deleted = true
      return undefined
    }
    const current = input.query?.page ?? 1
    pages.push(current)
    if (current === 1) return { ...firstPage, total: 20, has_more: false }
    return {
      data: deleted ? [] : [token],
      page: 2,
      limit: 20,
      total: deleted ? 20 : 21,
      has_more: false,
    }
  })
  const screen = await renderTokens('?patPage=2')
  await screen.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Token 1', exact: true })).toBeVisible()
  await expect
    .element(screen.getByText('No personal access tokens', { exact: true }))
    .not.toBeInTheDocument()
  expect(pages).toEqual([2, 2, 1])
  await expect
    .element(screen.getByRole('button', { name: 'Previous', exact: true }))
    .not.toBeInTheDocument()
})

it('returns keyboard focus to Create token after deletion removes the trigger row', async () => {
  // The feature's list refresh removes the initiating button before the dialog
  // closes. Verify focus restoration through real portal/close transitions.
  let deleted = false
  transport.call.mockImplementation(async (path: string[]) => {
    if (path.at(-1) === 'delete') {
      deleted = true
      return undefined
    }
    return {
      data: deleted
        ? []
        : [
            {
              id: '019a0000-0000-7000-8000-000000000001',
              name: 'release-pipeline',
              secret_last_four: '7f21',
              created_at: '2026-10-15T00:00:00Z',
              expires_at: null,
              last_used_at: null,
              resource_scope_mode: 'all',
              workspace_scope_mode: 'all',
              resource_count: 0,
              workspace_count: 0,
              unavailable_count: 0,
              status: 'active',
              version: 1,
            },
          ],
      page: 1,
      limit: 20,
      total: deleted ? 0 : 1,
      has_more: false,
    }
  })
  const queryClient = createTestQueryClient()
  seedSystemFeatures(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter>
        <PersonalAccessTokens />
      </NuqsTestingAdapter>
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.element(screen.getByText('No personal access tokens')).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
})
