import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DeleteConfirm } from '../delete-confirm'

const hookOptions = vi.hoisted(() => ({}) as Record<string, unknown>)

const mockRefetch = vi.fn()
const mockDelete = vi.fn()
const mockDeleteState = { isPending: false }
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

vi.mock('@/service/use-triggers', () => ({
  useDeleteTriggerSubscription: (...args: unknown[]) => {
    hookOptions.useDeleteTriggerSubscription = args.at(-1)
    return {
      mutate: mockDelete,
      isPending: mockDeleteState.isPending,
    }
  },
}))

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
  mockDeleteState.isPending = false
  mockDelete.mockImplementation((_id: string, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.()
  })
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

    expect(mockDelete).toHaveBeenCalledWith('sub-1', expect.any(Object))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('should leave a failed deletion to the delete mutation', () => {
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

    expect(hookOptions.useDeleteTriggerSubscription).toEqual({
      meta: {
        errorMessage:
          'pluginTrigger.subscription.list.item.actions.deleteConfirm.error:{"name":"Subscription One"}',
      },
    })
    expect(mockDelete.mock.calls[0]![1]).not.toHaveProperty('onError')
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('should ignore form submission while deletion is pending', async () => {
    mockDeleteState.isPending = true
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

    expect(mockDelete).not.toHaveBeenCalled()
  })
})
