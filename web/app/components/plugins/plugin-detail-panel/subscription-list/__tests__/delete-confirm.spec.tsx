import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { DeleteConfirm } from '../delete-confirm'

const requests = vi.hoisted(() => ({ remove: vi.fn(), refetch: vi.fn() }))
vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: requests.refetch }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.bySubscriptionId.subscriptions.delete.post':
        requests.remove,
    }),
  }
})
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
const confirmName = 'pluginTrigger.subscription.list.item.actions.deleteConfirm.confirm'
beforeEach(() => requests.remove.mockResolvedValue({}))

it('requires the subscription name and prevents repeated submission while deletion is pending', async () => {
  const user = userEvent.setup()
  const request = createDeferred<object>()
  requests.remove.mockReturnValue(request.promise)
  const onClose = vi.fn()
  render(
    <DeleteConfirm
      isShow
      currentId="sub-1"
      currentName="Subscription One"
      workflowsInUse={1}
      onClose={onClose}
    />,
  )
  await user.click(screen.getByRole('button', { name: confirmName }))
  expect(requests.remove).not.toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith(
    'pluginTrigger.subscription.list.item.actions.deleteConfirm.confirmInputWarning',
  )
  const input = screen.getByRole('textbox', { name: /confirmInputTip/ })
  await user.type(input, 'Subscription One{Enter}')
  await waitFor(() => expect(requests.remove).toHaveBeenCalledOnce())
  expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
  await user.type(input, '{Enter}')
  expect(requests.remove).toHaveBeenCalledExactlyOnceWith({ params: { subscription_id: 'sub-1' } })
  expect(onClose).not.toHaveBeenCalled()
  request.resolve({})
  await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith(true))
  expect(requests.refetch).toHaveBeenCalledOnce()
})

it('reports a failed deletion and allows retry without closing', async () => {
  const user = userEvent.setup()
  requests.remove.mockRejectedValueOnce(new Error('network error'))
  const onClose = vi.fn()
  render(
    <DeleteConfirm
      isShow
      currentId="sub-1"
      currentName="Subscription One"
      workflowsInUse={0}
      onClose={onClose}
    />,
  )
  await user.click(screen.getByRole('button', { name: confirmName }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('network error'))
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: confirmName }))
  await waitFor(() => expect(onClose).toHaveBeenCalledExactlyOnceWith(true))
})
