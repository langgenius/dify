import type { ComponentProps, ReactNode } from 'react'
import type { EventEmitterValue } from '@/context/event-emitter'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { UPDATE_DATASETS_EVENT_EMITTER } from '../../../constants'
import ContextBlockComponent from '../component'
import { ContextBlockNode } from '../node'

const datasets = [
  { id: '1', name: 'Dataset A', type: 'text' },
  { id: '2', name: 'Dataset B', type: 'text' },
]

function renderContext(props: Partial<ComponentProps<typeof ContextBlockComponent>> = {}) {
  let emit: (event: EventEmitterValue) => void = () => {}
  function CaptureEmitter() {
    const { eventEmitter } = useEventEmitterContextContext()
    emit = (event) => eventEmitter!.emit(event)
    return null
  }
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <EventEmitterContextProvider>
        <CaptureEmitter />
        <LexicalComposer
          initialConfig={{
            namespace: 'context-test',
            nodes: [ContextBlockNode],
            onError: (error) => {
              throw error
            },
          }}
        >
          {children}
        </LexicalComposer>
      </EventEmitterContextProvider>
    )
  }
  return {
    ...render(<ContextBlockComponent nodeKey="context" onAddContext={vi.fn()} {...props} />, {
      wrapper: Wrapper,
    }),
    emit: (event: EventEmitterValue) => emit(event),
  }
}

const getTrigger = () =>
  screen.getByRole('button', { name: 'common.promptEditor.context.item.title' })

describe('ContextBlockComponent', () => {
  it('opens the selected datasets and invokes the add action', async () => {
    const user = userEvent.setup()
    const onAddContext = vi.fn()
    renderContext({ datasets, onAddContext })
    expect(getTrigger()).toHaveTextContent('2')
    expect(screen.queryByText('Dataset A')).not.toBeInTheDocument()
    await user.click(getTrigger())
    expect(await screen.findByText('Dataset A')).toBeInTheDocument()
    expect(screen.getByText('Dataset B')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.promptEditor.context.modal.add' }))
    expect(onAddContext).toHaveBeenCalledTimes(1)
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Dataset A')).not.toBeInTheDocument()
  })

  it('omits dataset controls when adding context is forbidden', () => {
    renderContext({ datasets, canNotAddContext: true })
    expect(screen.getByText('common.promptEditor.context.item.title')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('updates an initially empty block from dataset events', async () => {
    const user = userEvent.setup()
    const { emit } = renderContext()
    expect(getTrigger()).toHaveTextContent('0')
    act(() => emit({ type: UPDATE_DATASETS_EVENT_EMITTER, payload: datasets }))
    expect(getTrigger()).toHaveTextContent('2')
    await user.click(getTrigger())
    expect(await screen.findByText('Dataset A')).toBeInTheDocument()
    act(() => emit({ type: UPDATE_DATASETS_EVENT_EMITTER, payload: [] }))
    expect(getTrigger()).toHaveTextContent('0')
    expect(screen.queryByText('Dataset A')).not.toBeInTheDocument()
  })

  it.each([
    'unrelated',
    { type: 'other-event', payload: [] },
    { type: UPDATE_DATASETS_EVENT_EMITTER, payload: null },
  ])('ignores unrelated or malformed events: %j', async (event) => {
    const user = userEvent.setup()
    const { emit } = renderContext({ datasets })
    act(() => emit(event))
    expect(getTrigger()).toHaveTextContent('2')
    await user.click(getTrigger())
    expect(await screen.findByText('Dataset A')).toBeInTheDocument()
    expect(screen.getByText('Dataset B')).toBeInTheDocument()
  })
})
