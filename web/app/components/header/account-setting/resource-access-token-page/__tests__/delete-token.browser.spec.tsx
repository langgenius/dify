import type {
  ResourceAccessTokenListResponse,
  ResourceAccessTokenRowResponse,
} from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { createDeferred } from '@/test/deferred'
import MenuDialog from '../../menu-dialog'
import ResourceAccessTokenPage from '../index'

const { listTokens, deleteToken } = vi.hoisted(() => ({
  listTokens: vi.fn(),
  deleteToken: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'resourceAccessTokens.get': listTokens,
      'resourceAccessTokens.byTokenId.relations.byRelationId.delete': deleteToken,
    }),
  }
})

const first = {
  created_at: 1787000000,
  token_id: 'token-1',
  relation_id: 'relation-1',
  name: 'First token',
  masked_token: 'masked',
  resource_type: 'app',
  resource_id: 'app-1',
  resource_name: 'Support app',
  track_id: 'first',
} satisfies ResourceAccessTokenRowResponse
const next = { ...first, token_id: 'token-2', relation_id: 'relation-2', name: 'Next token' }
const listResponse = (data: ResourceAccessTokenRowResponse[], total = data.length) =>
  ({
    data,
    total,
    limit: 20,
    page: 1,
    has_more: false,
  }) satisfies ResourceAccessTokenListResponse
const deleteLabel = 'common.operation.delete'
const cancelLabel = 'common.operation.cancel'
const closeSettings = vi.fn()

async function renderPage() {
  const client = createAccountProfileQueryClient()
  onTestFinished(() => client.clear())
  return render(
    <QueryClientProvider client={client}>
      <MenuDialog title="Account settings" onClose={closeSettings}>
        <ResourceAccessTokenPage />
      </MenuDialog>
    </QueryClientProvider>,
  )
}

async function setup() {
  const screen = await renderPage()
  const opener = screen
    .getByRole('row', { name: /First token/ })
    .getByRole('button', { name: deleteLabel })
  await opener.click()
  const dialog = screen.getByRole('alertdialog', {
    name: 'accountSettings.resourceAccessToken.deleteTitle',
  })
  await expect.element(dialog).toBeVisible()
  return { screen, opener, dialog }
}

beforeEach(() => {
  listTokens.mockReset()
  deleteToken.mockReset()
  closeSettings.mockClear()
})

it('returns focus to the opener on cancel and to the next row on successful deletion', async () => {
  const anotherRelation = { ...first, relation_id: 'another-relation' }
  const refresh = createDeferred<ResourceAccessTokenListResponse>()
  const request = createDeferred()
  listTokens.mockResolvedValueOnce(listResponse([first, anotherRelation, next], 2))
  deleteToken.mockReturnValueOnce(request.promise)
  const { screen, opener, dialog } = await setup()

  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(opener).toHaveFocus()
  expect(closeSettings).not.toHaveBeenCalled()
  await userEvent.keyboard('{Enter}')

  const confirm = dialog.getByRole('button', { name: deleteLabel })
  await expect.element(confirm).toBeVisible()
  const button = confirm.element() as HTMLButtonElement
  button.focus()
  button.click()
  button.click()
  await expect.element(confirm).toHaveFocus()
  await expect.element(dialog.getByRole('button', { name: cancelLabel })).toBeDisabled()
  expect(deleteToken).toHaveBeenCalledExactlyOnceWith({
    params: { token_id: first.token_id, relation_id: first.relation_id },
  })

  listTokens.mockReturnValue(refresh.promise)
  request.resolve()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(opener).not.toBeInTheDocument()
  await expect
    .element(
      screen
        .getByRole('row', { name: /Next token/ })
        .getByRole('button', { name: 'common.operation.edit' }),
    )
    .toHaveFocus()
  refresh.resolve(listResponse([next]))
})

it('opens row resource details and submits the selected row through the shared dialog', async () => {
  const resourceName = 'Second support app'
  listTokens.mockResolvedValueOnce(listResponse([first, { ...next, resource_name: resourceName }]))
  deleteToken.mockResolvedValueOnce(undefined)
  const screen = await renderPage()
  const secondRow = screen.getByRole('row', { name: /Next token/ })
  const detailsTrigger = secondRow.getByRole('button', {
    name: 'Next token · accountSettings.resourceAccessToken.accessibleResources',
  })

  await detailsTrigger.click()
  const resourceDetails = screen.getByText(resourceName)
  await expect.element(resourceDetails).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(resourceDetails).not.toBeInTheDocument()
  await expect.element(detailsTrigger).toHaveFocus()
  expect(closeSettings).not.toHaveBeenCalled()

  await secondRow.getByRole('button', { name: deleteLabel }).click()
  const alertDialog = screen.getByRole('alertdialog', {
    name: 'accountSettings.resourceAccessToken.deleteTitle',
  })
  listTokens.mockResolvedValue(listResponse([first]))
  await alertDialog.getByRole('button', { name: deleteLabel }).click()

  await expect.element(alertDialog).not.toBeInTheDocument()
  await expect.element(secondRow).not.toBeInTheDocument()
  expect(deleteToken).toHaveBeenCalledExactlyOnceWith({
    params: { token_id: next.token_id, relation_id: next.relation_id },
  })
})

it('fails without queueing offline, allows retry, and focuses Create when the last token disappears', async () => {
  listTokens.mockResolvedValueOnce(listResponse([first]))
  deleteToken.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined)
  const { screen, dialog } = await setup()
  onlineManager.setOnline(false)
  onTestFinished(() => onlineManager.setOnline(true))

  const confirm = dialog.getByRole('button', { name: deleteLabel })
  await confirm.click()
  await expect.element(dialog.getByRole('alert')).toHaveTextContent('Offline')
  await expect.element(dialog.getByRole('button', { name: cancelLabel })).toBeEnabled()

  listTokens.mockResolvedValue(listResponse([]))
  await confirm.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(
      screen.getByRole('button', { name: 'accountSettings.resourceAccessToken.createButton' }),
    )
    .toHaveFocus()
  expect(deleteToken).toHaveBeenCalledTimes(2)
})

it('returns to the preceding page when deletion removes the last page', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({
    ...next,
    token_id: `previous-${index}`,
    relation_id: `previous-relation-${index}`,
    name: `Previous token ${index + 1}`,
  }))
  let removed = false
  const refreshed = createDeferred<ResourceAccessTokenListResponse>()
  listTokens.mockImplementation(async ({ query }: { query: { page: number } }) => {
    const total = removed ? 20 : 21
    if (query.page === 1) {
      if (removed) return refreshed.promise
      return { ...listResponse(firstPage, total), has_more: true }
    }
    return { ...listResponse(removed ? [] : [first], total), page: 2 }
  })
  deleteToken.mockImplementation(async () => {
    removed = true
  })
  const screen = await renderPage()
  await screen.getByRole('button', { name: 'accountSettings.resourceAccessToken.next' }).click()
  await screen
    .getByRole('row', { name: /First token/ })
    .getByRole('button', { name: deleteLabel })
    .click()
  const dialog = screen.getByRole('alertdialog')
  await dialog.getByRole('button', { name: deleteLabel }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  const remaining = screen.getByRole('row', { name: /Previous token 1 / })
  await expect.element(remaining).toBeInTheDocument()
  const nextPage = screen.getByRole('button', { name: 'accountSettings.resourceAccessToken.next' })
  // Page one may still report the old count while its new response is in flight.
  await nextPage.click()
  await expect.element(remaining).toBeInTheDocument()
  refreshed.resolve(listResponse(firstPage))
  await expect.element(nextPage).toBeDisabled()
})

it('prevents deleting a retained row while a different search is loading', async () => {
  const search = createDeferred<ResourceAccessTokenListResponse>()
  listTokens.mockResolvedValueOnce(listResponse([first])).mockReturnValue(search.promise)
  const screen = await renderPage()
  const opener = screen
    .getByRole('row', { name: /First token/ })
    .getByRole('button', { name: deleteLabel })
  await expect.element(opener).toBeEnabled()
  await screen.getByRole('searchbox').fill('Next')
  await expect.element(opener).toBeDisabled()
  await expect.poll(() => listTokens.mock.calls.length).toBe(2)
  await expect.element(opener).toBeDisabled()
  expect(deleteToken).not.toHaveBeenCalled()

  search.resolve(listResponse([next]))
  await expect
    .element(
      screen.getByRole('row', { name: /Next token/ }).getByRole('button', { name: deleteLabel }),
    )
    .toBeEnabled()
})
