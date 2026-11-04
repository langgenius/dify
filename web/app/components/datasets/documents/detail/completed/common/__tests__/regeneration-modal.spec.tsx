import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import RegenerationModal from '../regeneration-modal'

function setup() {
  let emit!: (event: string) => void
  function CaptureEmitter() {
    const { eventEmitter } = useEventEmitterContextContext()
    emit = (event) => eventEmitter!.emit(event)
    return null
  }
  const props = { isShow: true, onConfirm: vi.fn(), onCancel: vi.fn(), onClose: vi.fn() }
  render(
    <EventEmitterContextProvider>
      <CaptureEmitter />
      <RegenerationModal {...props} />
    </EventEmitterContextProvider>,
  )
  return { ...props, emit: (event: string) => act(() => emit(event)) }
}

it('cancels regeneration without invoking the mutation', async () => {
  const user = userEvent.setup()
  const callbacks = setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(callbacks.onCancel).toHaveBeenCalledOnce()
  expect(callbacks.onConfirm).not.toHaveBeenCalled()
})

it('blocks repeated confirmation while regenerating, permits retry after failure, and closes after success', async () => {
  const user = userEvent.setup()
  const callbacks = setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.regenerate' }))
  expect(callbacks.onConfirm).toHaveBeenCalledOnce()
  callbacks.emit('update-segment')
  expect(screen.getByText('datasetDocuments.segment.regeneratingTitle')).toBeInTheDocument()
  const regenerate = screen.getByRole('button', { name: 'common.operation.regenerate' })
  expect(regenerate).toBeDisabled()
  await user.click(regenerate)
  expect(callbacks.onConfirm).toHaveBeenCalledOnce()

  callbacks.emit('update-segment-done')
  await user.click(screen.getByRole('button', { name: 'common.operation.regenerate' }))
  expect(callbacks.onConfirm).toHaveBeenCalledTimes(2)
  callbacks.emit('update-segment')
  callbacks.emit('update-segment-success')
  callbacks.emit('update-segment-done')
  expect(screen.getByText('datasetDocuments.segment.regenerationSuccessTitle')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /common.operation.close/ }))
  expect(callbacks.onClose).toHaveBeenCalledOnce()
})
