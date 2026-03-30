import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteConfirm } from '../delete-confirm'

const mockRefetch = vi.fn()
const mockDelete = vi.fn()
const mockToastSuccess = vi.hoisted(() => vi.fn())
const mockToastError = vi.hoisted(() => vi.fn())

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

vi.mock('@/service/use-triggers', () => ({
  useDeleteTriggerSubscription: () => ({ mutate: mockDelete, isPending: false }),
}))

vi.mock('@/app/components/base/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/ui/toast')>()
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

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirm/ }))

    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith('pluginTrigger.subscription.list.item.actions.deleteConfirm.confirmInputWarning')
  })

  it('should allow deletion after matching input name', () => {
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

    fireEvent.change(
      screen.getByPlaceholderText(/pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirmInputPlaceholder/),
      { target: { value: 'Subscription One' } },
    )

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirm/ }))

    expect(mockDelete).toHaveBeenCalledWith('sub-1', expect.any(Object))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(true)
  })

  it('should show error toast when delete fails', () => {
    mockDelete.mockImplementation((_id: string, options?: { onError?: (error: Error) => void }) => {
      options?.onError?.(new Error('network error'))
    })

    render(
      <DeleteConfirm
        isShow
        currentId="sub-1"
        currentName="Subscription One"
        workflowsInUse={0}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirm/ }))

    expect(mockToastError).toHaveBeenCalledWith('network error')
  })
})
