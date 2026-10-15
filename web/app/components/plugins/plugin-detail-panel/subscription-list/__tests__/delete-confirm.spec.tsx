import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DeleteConfirm } from '../delete-confirm'

const mockRefetch = vi.fn()
const mockDelete = vi.fn()
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

vi.mock('@/service/use-triggers', async () => {
  const { useMutation } = await import('@tanstack/react-query')
  const { createTestQueryClient } = await import('@/test/query-client')
  const mutationClient = createTestQueryClient()
  return {
    useDeleteTriggerSubscription: (options: Record<string, unknown> = {}) =>
      useMutation(
        { mutationFn: (variables: unknown) => mockDelete(variables), ...options },
        mutationClient,
      ),
  }
})

vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mockToastSuccess,
      error: mockToastError,
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mockDelete.mockResolvedValue(undefined)
})

describe('DeleteConfirm', () => {
  it('should prevent deletion when workflows in use and input mismatch', () => {
    render(
      <DeleteConfirm
        isShow
        currentId="sub-1"
        currentName="Subscription One"
        workflowsInUse={2}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirm/,
      }),
    )

    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith(
      'pluginTrigger.subscription.list.item.actions.deleteConfirm.confirmInputWarning',
    )
  })

  it('should allow deletion by submitting a matching input name', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <DeleteConfirm
        isShow
        currentId="sub-1"
        currentName="Subscription One"
        workflowsInUse={1}
        onClose={onClose}
      />,
    )

    await user.type(
      screen.getByRole('textbox', {
        name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirmInputTip/,
      }),
      'Subscription One{Enter}',
    )

    expect(mockDelete).toHaveBeenCalledWith('sub-1')
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('should show error toast when delete fails', async () => {
    mockDelete.mockRejectedValue(new Error('network error'))

    render(
      <DeleteConfirm
        isShow
        currentId="sub-1"
        currentName="Subscription One"
        workflowsInUse={0}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirm/,
      }),
    )

    await waitFor(() => expect(mockToastError).toHaveBeenCalledExactlyOnceWith('network error'))
  })

  it('should ignore form submission while deletion is pending', async () => {
    mockDelete.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()

    render(
      <DeleteConfirm
        isShow
        currentId="sub-1"
        currentName="Subscription One"
        workflowsInUse={1}
        onClose={vi.fn()}
      />,
    )

    await user.type(
      screen.getByRole('textbox', {
        name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirmInputTip/,
      }),
      'Subscription One{Enter}',
    )

    await user.keyboard('{Enter}')
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })
})
