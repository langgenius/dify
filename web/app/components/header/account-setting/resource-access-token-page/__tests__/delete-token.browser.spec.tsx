import type {
  ResourceAccessTokenListResponse,
  ResourceAccessTokenRowResponse,
} from '@dify/contracts/api/console/resource-access-tokens/types.gen'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { createDeferred } from '@/test/deferred'
import { hold, networkError, setupFakeApi } from '@/test/fake-api'
import MenuDialog from '../../menu-dialog'
import ResourceAccessTokenPage from '../index'

const first = {
  created_at: 1787000000,
  token_id: '0f1e2d3c-4b5a-4968-8776-655443322110',
  relation_id: '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
  name: 'First token',
  masked_token: 'masked',
  resource_type: 'app',
  resource_id: 'app-1',
  resource_name: 'Support app',
  track_id: 'first',
} satisfies ResourceAccessTokenRowResponse
const next = {
  ...first,
  token_id: '2b3c4d5e-6f7a-4b8c-9d0e-2f3a4b5c6d7e',
  relation_id: '3c4d5e6f-7a8b-4c9d-8e0f-3a4b5c6d7e8f',
  name: 'Next token',
}
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

const fake = setupFakeApi({
  console: {
    resourceAccessTokens: {
      get: () => listResponse([]),
      byTokenId: { relations: { byRelationId: { delete: () => undefined } } },
    },
  },
})
const listTokens = () => fake.console.resourceAccessTokens.get
const deleteToken = () => fake.console.resourceAccessTokens.byTokenId.relations.byRelationId.delete

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
  closeSettings.mockClear()
})

it('returns focus to the opener on cancel and to the next row on successful deletion', async () => {
  const anotherRelation = { ...first, relation_id: '4d5e6f7a-8b9c-4d0e-8f1a-4b5c6d7e8f9a' }
  listTokens().mockResolvedValueOnce(listResponse([first, anotherRelation, next], 2))
  const request = hold(deleteToken())
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
  expect(deleteToken()).toHaveBeenCalledExactlyOnceWith({
    params: { token_id: first.token_id, relation_id: first.relation_id },
  })

  const refresh = hold(listTokens())
  request.resolve(undefined)
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
  listTokens().mockResolvedValueOnce(
    listResponse([first, { ...next, resource_name: resourceName }]),
  )
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
  listTokens().mockResolvedValue(listResponse([first]))
  await alertDialog.getByRole('button', { name: deleteLabel }).click()

  await expect.element(alertDialog).not.toBeInTheDocument()
  await expect.element(secondRow).not.toBeInTheDocument()
  expect(deleteToken()).toHaveBeenCalledExactlyOnceWith({
    params: { token_id: next.token_id, relation_id: next.relation_id },
  })
})

it('fails without queueing offline, allows retry, and focuses Create when the last token disappears', async () => {
  listTokens().mockResolvedValueOnce(listResponse([first]))
  deleteToken().mockRejectedValueOnce(networkError())
  const { screen, dialog } = await setup()
  onlineManager.setOnline(false)
  onTestFinished(() => onlineManager.setOnline(true))

  const confirm = dialog.getByRole('button', { name: deleteLabel })
  await confirm.click()
  await expect.element(dialog.getByRole('alert')).toBeVisible()
  await expect
    .poll(() => dialog.getByRole('alert').element().textContent)
    .toMatch(/^Request failed due to a network error/)
  await expect.element(dialog.getByRole('button', { name: cancelLabel })).toBeEnabled()

  listTokens().mockResolvedValue(listResponse([]))
  await confirm.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect
    .element(
      screen.getByRole('button', { name: 'accountSettings.resourceAccessToken.createButton' }),
    )
    .toHaveFocus()
  expect(deleteToken()).toHaveBeenCalledTimes(2)
})

it('returns to the preceding page when deletion removes the last page', async () => {
  const firstPage = Array.from({ length: 20 }, (_, index) => ({
    ...next,
    token_id: `5e6f7a8b-9c0d-4e1f-8a2b-${String(index).padStart(12, '0')}`,
    relation_id: `6f7a8b9c-0d1e-4f2a-8b3c-${String(index).padStart(12, '0')}`,
    name: `Previous token ${index + 1}`,
  }))
  let removed = false
  const refreshed = createDeferred<ResourceAccessTokenListResponse>()
  listTokens().mockImplementation(async (input) => {
    const total = removed ? 20 : 21
    if ((input?.query?.page ?? 1) === 1) {
      if (removed) return refreshed.promise
      return { ...listResponse(firstPage, total), has_more: true }
    }
    return { ...listResponse(removed ? [] : [first], total), page: 2 }
  })
  deleteToken().mockImplementation(async () => {
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
  listTokens().mockResolvedValueOnce(listResponse([first]))
  const search = hold(listTokens())
  const screen = await renderPage()
  const opener = screen
    .getByRole('row', { name: /First token/ })
    .getByRole('button', { name: deleteLabel })
  await expect.element(opener).toBeEnabled()
  await screen.getByRole('searchbox').fill('Next')
  await expect.element(opener).toBeDisabled()
  await search.arrived
  expect(listTokens()).toHaveBeenCalledTimes(2)
  await expect.element(opener).toBeDisabled()
  expect(deleteToken()).not.toHaveBeenCalled()

  search.resolve(listResponse([next]))
  await expect
    .element(
      screen.getByRole('row', { name: /Next token/ }).getByRole('button', { name: deleteLabel }),
    )
    .toBeEnabled()
})
