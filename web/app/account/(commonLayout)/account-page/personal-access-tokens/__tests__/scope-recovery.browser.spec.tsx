import type {
  PersonalAccessTokenResourceCandidateResponse,
  PersonalAccessTokenWorkspaceCandidateResponse,
} from '@dify/contracts/api/console/account/types.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { firstPage, renderTokens, token } from './browser-test-env'

const transport = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('@/service/console/browser', () => ({ consoleBrowserLink: transport }))
vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(1100, 800)
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
  const firstSearch = createDeferred<void>()
  const searchCursors: number[] = []
  transport.call.mockImplementation(
    async (path: string[], input: { query: { cursor: number; keyword: string } }) => {
      if (!path.includes('personalAccessTokenWorkspaces'))
        return { ...firstPage, data: [], total: 0, has_more: false }

      const { cursor, keyword } = input.query
      const lastPage = { next_cursor: null, has_more: false }
      if (keyword !== 'Production') return { ...lastPage, data: keyword ? [] : [workspace] }

      searchCursors.push(cursor)
      if (searchCursors.length === 1) {
        await firstSearch.promise
        throw new Error('Workspace search unavailable')
      }
      return { ...lastPage, data: [workspace, sandbox] }
    },
  )

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
    const next = createDeferred<
      PersonalAccessTokenResourceCandidateResponse | PersonalAccessTokenWorkspaceCandidateResponse
    >()
    const candidates:
      | PersonalAccessTokenResourceCandidateResponse
      | PersonalAccessTokenWorkspaceCandidateResponse =
      scope === 'Resources'
        ? {
            data: firstPage.data.map((item) => ({
              resource_id: item.id,
              resource_type: 'dataset',
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
    const candidatePath =
      scope === 'Resources' ? 'personalAccessTokenResources' : 'personalAccessTokenWorkspaces'
    transport.call.mockImplementation(
      async (path: string[], input: { query: { cursor?: number; resource_type?: string } }) => {
        if (!path.includes(candidatePath))
          return { ...firstPage, data: [], total: 0, has_more: false }
        if (scope === 'Resources' && input.query.resource_type !== 'dataset')
          return { data: [], next_cursor: null, has_more: false }
        cursors.push(input.query.cursor ?? 0)
        if (cursors.length === 2) throw new Error('Later page unavailable')
        if (input.query.cursor === 20) return next.promise
        return candidates
      },
    )
    const screen = await renderTokens()
    await screen.getByRole('button', { name: 'Create token' }).click()
    const dialog = screen.getByRole('dialog')
    await dialog
      .getByRole('radiogroup', { name: scope === 'Resources' ? scope : 'Manage workspaces' })
      .getByRole('radio', { name: 'Selected' })
      .click()
    if (scope === 'Resources')
      await dialog.getByRole('tab', { name: 'Knowledge bases 0 selected' }).click()
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
                resource_type: 'dataset',
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
