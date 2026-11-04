import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ChildSegmentDetail from '../child-segment-detail'

vi.mock('../../context', () => ({
  useDocumentContext: (select: (state: { canEdit: boolean }) => unknown) =>
    select({ canEdit: true }),
}))
vi.mock('../index', () => ({
  useSegmentListContext: (
    select: (state: { fullScreen: boolean; toggleFullScreen: () => void }) => unknown,
  ) => select({ fullScreen: false, toggleFullScreen: vi.fn() }),
}))

function setup() {
  let emit!: (event: string) => void
  function CaptureEmitter() {
    const { eventEmitter } = useEventEmitterContextContext()
    emit = (event) => eventEmitter!.emit(event)
    return null
  }
  const onUpdate = vi.fn()
  const onCancel = vi.fn()
  render(
    <EventEmitterContextProvider>
      <CaptureEmitter />
      <ChildSegmentDetail
        chunkId="parent-1"
        childChunkInfo={{ id: 'child-1', content: 'Original', position: 1 }}
        docForm={ChunkingMode.parentChild}
        onUpdate={onUpdate}
        onCancel={onCancel}
      />
    </EventEmitterContextProvider>,
  )
  return { onUpdate, onCancel, emit: (event: string) => act(() => emit(event)) }
}

it('saves edited content with parent and child identities and blocks duplicate saves while updating', async () => {
  const user = userEvent.setup()
  const { onUpdate, emit } = setup()
  await user.type(
    screen.getByRole('textbox', { name: 'datasetDocuments.segment.contentPlaceholder' }),
    ' updated',
  )
  await user.click(screen.getByRole('button', { name: /common.operation.save/ }))
  expect(onUpdate).toHaveBeenCalledWith('parent-1', 'child-1', 'Original updated')
  emit('update-child-segment')
  const save = screen.getByRole('button', { name: /common.operation.save/ })
  expect(save).toBeDisabled()
  await user.click(save)
  expect(onUpdate).toHaveBeenCalledOnce()
  emit('update-child-segment-done')
  expect(save).toBeEnabled()
})

it('discards an edited draft when canceled', async () => {
  const user = userEvent.setup()
  const { onUpdate, onCancel } = setup()
  await user.type(screen.getByRole('textbox'), ' draft')
  await user.click(screen.getByRole('button', { name: /common.operation.cancel/ }))
  expect(onCancel).toHaveBeenCalledOnce()
  expect(onUpdate).not.toHaveBeenCalled()
})
