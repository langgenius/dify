import type {
  PersonalAccessTokenListResponse,
  PersonalAccessTokenResourceCandidateResponse,
  PersonalAccessTokenResponse,
  PersonalAccessTokenWorkspaceCandidateResponse,
} from '@dify/contracts/api/console/account/types.gen'
import type { FakeApi } from '@/test/fake-api'
import { page, userEvent } from 'vite-plus/test/browser'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { apiError, installFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { createTestQueryClient } from '@/test/query-client'
import PersonalAccessTokens from '../index'
import { renderWithTokenMessages as render } from './browser-test-env'

vi.unmock('react-i18next')

const token: PersonalAccessTokenResponse = {
  id: '019a0000-0000-7000-8000-000000000001',
  name: 'Page two token',
  secret_last_four: '7f21',
  created_at: '2026-10-15T00:00:00Z',
  expires_at: null,
  last_used_at: null,
  resource_scope_mode: 'all',
  workspace_scope_mode: 'none',
  resource_count: 0,
  workspace_count: 0,
  unavailable_count: 0,
  status: 'active',
  version: 1,
}
const firstPage: PersonalAccessTokenListResponse = {
  data: Array.from({ length: 20 }, (_, index) => ({
    ...token,
    id: `019a0000-0000-7000-8000-${String(index + 10).padStart(12, '0')}`,
    name: `Token ${index + 1}`,
  })),
  page: 1,
  limit: 20,
  total: 21,
  has_more: true,
}
const noTokens: PersonalAccessTokenListResponse = {
  ...firstPage,
  data: [],
  total: 0,
  has_more: false,
}

function installAccountApi(account: NonNullable<NonNullable<FakeApi['console']>['account']>) {
  const fake = installFakeApi({ console: { account } })
  onTestFinished(fake)
  return fake.console.account
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

async function renderTokens(searchParams = '') {
  const client = createTestQueryClient()
  seedSystemFeatures(client)
  await page.viewport(1100, 800)
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  const rendered = await render(
    <QueryClientTestProvider queryClient={client}>
      <UrlState>
        <div className="mx-auto w-full max-w-252 px-6 py-12">
          <PersonalAccessTokens />
        </div>
      </UrlState>
    </QueryClientTestProvider>,
  )
  return { ...rendered, onUrlUpdate }
}

it('keeps the table and pagination in place while blocking stale rows during a page change', async () => {
  const first = deferred<PersonalAccessTokenListResponse>()
  const next = deferred<PersonalAccessTokenListResponse>()
  installAccountApi({
    personalAccessTokens: {
      get: (input) => (input?.query?.page === 1 ? first.promise : next.promise),
    },
  })
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
  // Native Tab must skip the stale row actions while the next page is loading.
  await userEvent.tab({ shift: true })
  await expect.element(screen.getByRole('button', { name: '2/2: Edit page number' })).toHaveFocus()
  await userEvent.tab({ shift: true })
  await expect.element(screen.getByRole('button', { name: 'Previous', exact: true })).toHaveFocus()
  await userEvent.tab({ shift: true })
  await expect
    .element(screen.getByRole('button', { name: 'Previous', exact: true }))
    .not.toHaveFocus()
  await userEvent.tab({ shift: true })
  await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
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
  const lastPage = deferred<PersonalAccessTokenListResponse>()
  const api = installAccountApi({
    personalAccessTokens: {
      get: async (input) =>
        input?.query?.page === 1 ? { ...firstPage, total: 45 } : lastPage.promise,
    },
  })
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
  expect(api.personalAccessTokens.get.mock.calls.at(-1)?.[0]?.query?.page).toBe(3)
  lastPage.resolve({ data: [token], page: 3, limit: 20, total: 45, has_more: false })
  await expect.element(screen.getByRole('button', { name: token.name, exact: true })).toBeVisible()
  await expect.element(summary).toBeEnabled()
  await expect.element(pagination.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
})

it('recovers from an out-of-range token page in the URL', async () => {
  installAccountApi({
    personalAccessTokens: {
      get: (input) => {
        const current = input?.query?.page ?? 1
        return {
          ...firstPage,
          data: current === 1 ? firstPage.data : [],
          page: current,
          total: firstPage.data.length,
          has_more: false,
        }
      },
    },
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

it('keeps a checked workspace through search loading, retry, and an empty result', async () => {
  const workspace = {
    workspace_id: token.id,
    display_name: 'Production',
    available: true,
    role: 'owner',
    reason: null,
  }
  const sandbox = {
    ...workspace,
    workspace_id: '019a0000-0000-7000-8000-000000000002',
    display_name: 'Production sandbox',
  }
  const firstSearch = deferred<void>()
  const searchCursors: number[] = []
  installAccountApi({
    personalAccessTokens: { get: () => noTokens },
    personalAccessTokenWorkspaces: {
      get: async (input) => {
        const { cursor = 0, keyword = '' } = input?.query ?? {}
        const lastPage = { next_cursor: null, has_more: false }
        if (keyword !== 'Production') return { ...lastPage, data: keyword ? [] : [workspace] }

        searchCursors.push(cursor)
        if (searchCursors.length === 1) {
          await firstSearch.promise
          throw apiError({
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            message: 'Workspace search unavailable',
          })
        }
        return { ...lastPage, data: [workspace, sandbox] }
      },
    },
  })

  const screen = await renderTokens()
  await screen.getByRole('button', { name: 'Create token' }).click()
  const dialog = screen.getByRole('dialog')
  await dialog
    .getByRole('radiogroup', { name: 'Manage workspaces' })
    .getByRole('radio', { name: 'Selected' })
    .click()
  const selected = dialog.getByRole('checkbox', { name: 'Production', exact: true })
  await selected.click()
  await expect.element(selected).toBeChecked()
  const dialogHeight = dialog.element().getBoundingClientRect().height

  const searchbox = dialog.getByRole('searchbox')
  await searchbox.fill('Production')
  await expect.element(dialog.getByText('Your existing selection is preserved.')).toBeVisible()
  await expect.element(selected).toBeChecked()
  expect(dialog.element().getBoundingClientRect().height).toBe(dialogHeight)

  firstSearch.resolve(undefined)
  const error = dialog.getByRole('alert')
  await expect.element(error.getByText('Loading options failed')).toBeVisible()
  await expect.element(selected).toBeChecked()
  expect(dialog.element().getBoundingClientRect().height).toBe(dialogHeight)
  await error.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect.element(dialog.getByRole('checkbox', { name: 'Production sandbox' })).toBeVisible()
  await expect.element(selected).toBeChecked()
  expect(dialog.element().getBoundingClientRect().height).toBe(dialogHeight)
  expect(searchCursors).toEqual([0, 0])

  await searchbox.fill('No matching workspace')
  await expect.element(dialog.getByText('No workspaces found')).toBeVisible()
  expect(dialog.element().getBoundingClientRect().height).toBe(dialogHeight)
  await searchbox.fill('Production')
  await expect.element(selected).toBeChecked()
})

it.each(['Resources', 'Workspaces'] as const)(
  'retries the failed next page of %s and focuses the newly loaded option',
  async (scope) => {
    const cursors: number[] = []
    const next = deferred<
      PersonalAccessTokenResourceCandidateResponse | PersonalAccessTokenWorkspaceCandidateResponse
    >()
    const candidates:
      | PersonalAccessTokenResourceCandidateResponse
      | PersonalAccessTokenWorkspaceCandidateResponse =
      scope === 'Resources'
        ? {
            data: firstPage.data.map((item) => ({
              resource_id: item.id,
              resource_type: 'app_deployment',
              display_name: item.name,
              workspace_id: token.id,
              workspace_name: 'Production',
              available: true,
              reason: null,
            })),
            next_cursor: 20,
            has_more: true,
          }
        : {
            data: firstPage.data.map((item) => ({
              workspace_id: item.id,
              display_name: item.name,
              available: true,
              role: 'owner',
              reason: null,
            })),
            next_cursor: 20,
            has_more: true,
          }
    const candidatePage = async (cursor = 0) => {
      cursors.push(cursor)
      if (cursors.length === 2)
        throw apiError({
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Later page unavailable',
        })
      if (cursor === 20) return next.promise
      return candidates
    }
    // `candidates` and `next` hold the response type of the scope under test.
    installAccountApi({
      personalAccessTokens: { get: () => noTokens },
      ...(scope === 'Resources'
        ? {
            personalAccessTokenResources: {
              get: (input) =>
                input?.query?.resource_type === 'app'
                  ? (candidatePage(
                      input.query.cursor,
                    ) as Promise<PersonalAccessTokenResourceCandidateResponse>)
                  : { data: [], next_cursor: null, has_more: false },
            },
          }
        : {
            personalAccessTokenWorkspaces: {
              get: (input) =>
                candidatePage(
                  input?.query?.cursor,
                ) as Promise<PersonalAccessTokenWorkspaceCandidateResponse>,
            },
          }),
    })
    const screen = await renderTokens()
    await screen.getByRole('button', { name: 'Create token' }).click()
    const dialog = screen.getByRole('dialog')
    await dialog
      .getByRole('radiogroup', { name: scope === 'Resources' ? scope : 'Manage workspaces' })
      .getByRole('radio', { name: 'Selected' })
      .click()
    if (scope === 'Resources') await expect.element(dialog.getByRole('tab')).not.toBeInTheDocument()
    const selected = dialog.getByRole('checkbox', { name: 'Token 1', exact: true })
    await selected.click()
    const loadMore = dialog.getByRole('button', {
      name: scope === 'Resources' ? 'Load more resources' : 'Load more workspaces',
    })
    await loadMore.click()
    const retry = dialog.getByRole('button', { name: "Couldn't load more. Retry" })
    await expect.element(retry).toHaveFocus()
    await expect.element(selected).toBeChecked()
    await expect.element(loadMore).not.toBeInTheDocument()

    await userEvent.keyboard('{Enter}')
    const loading = dialog.getByRole('button', { name: 'Loading' })
    await expect.element(loading).toBeDisabled()
    await expect.element(loading).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(cursors).toEqual([0, 20, 20])

    const candidate = {
      display_name: 'New option',
      workspace_id: token.id,
      available: true,
      reason: null,
    }
    const lastPage = { next_cursor: null, has_more: false }
    next.resolve(
      scope === 'Resources'
        ? {
            ...lastPage,
            data: [
              {
                ...candidate,
                resource_id: token.id,
                resource_type: 'app_deployment',
                workspace_name: 'Production',
              },
            ],
          }
        : { ...lastPage, data: [{ ...candidate, role: 'owner' }] },
    )
    await expect.element(dialog.getByRole('checkbox', { name: 'New option' })).toHaveFocus()
    await expect.element(dialog.getByRole('status')).toHaveTextContent('All results shown')
    await expect.element(retry).not.toBeInTheDocument()
    await expect.element(selected).toBeChecked()
  },
)

it.each(['create', 'duplicate'] as const)(
  'shows the secret immediately after %s succeeds while the token list is still refreshing',
  async (entry) => {
    const refresh = deferred<PersonalAccessTokenListResponse>()
    const createdToken = { ...token, id: '019a0000-0000-7000-8000-000000000999', name: 'New token' }
    let created = false
    const api = installAccountApi({
      personalAccessTokens: {
        get: async () =>
          created
            ? refresh.promise
            : {
                data: entry === 'create' ? [] : [token],
                page: 1,
                limit: 20,
                total: entry === 'create' ? 0 : 1,
                has_more: false,
              },
        post: () => {
          created = true
          return { ...createdToken, secret: 'dpat_fixture_secret' }
        },
        byTokenId: { get: () => ({ token, resources: [], workspaces: [] }) },
      },
    })
    const screen = await renderTokens()
    if (entry === 'create') await screen.getByRole('button', { name: 'Create token' }).click()
    else await screen.getByRole('button', { name: 'Duplicate', exact: true }).click()
    const dialog = screen.getByRole('dialog')
    await dialog.getByRole('textbox', { name: 'Name' }).fill(createdToken.name)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await vi.waitFor(() => expect(api.personalAccessTokens.get).toHaveBeenCalledTimes(2))
    await expect
      .element(dialog.getByRole('textbox', { name: 'Token', exact: true }))
      .toHaveValue('dpat_fixture_secret')
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(screen.getByRole('button', { name: 'Create token' })).toHaveFocus()
    refresh.resolve({ data: [createdToken], page: 1, limit: 20, total: 1, has_more: false })
    await expect
      .element(screen.getByRole('button', { name: createdToken.name, exact: true }))
      .toBeVisible()
  },
)

it('returns to the previous page after deleting the last token on a deep-linked final page', async () => {
  let deleted = false
  const api = installAccountApi({
    personalAccessTokens: {
      get: (input) =>
        (input?.query?.page ?? 1) === 1
          ? { ...firstPage, total: 20, has_more: false }
          : {
              data: deleted ? [] : [token],
              page: 2,
              limit: 20,
              total: deleted ? 20 : 21,
              has_more: false,
            },
      byTokenId: {
        delete: () => {
          deleted = true
        },
      },
    },
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
  expect(api.personalAccessTokens.get.mock.calls.map(([input]) => input?.query?.page ?? 1)).toEqual(
    [2, 2, 1],
  )
  await expect
    .element(screen.getByRole('button', { name: 'Previous', exact: true }))
    .not.toBeInTheDocument()
})

it('reports that the token list could not load', async () => {
  installAccountApi({
    personalAccessTokens: {
      get: () => {
        throw apiError({
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Token list unavailable',
        })
      },
    },
  })
  const screen = await renderTokens()
  await expect.element(screen.getByRole('alert')).toMatchTextContent(/Could not load access tokens/)
})
