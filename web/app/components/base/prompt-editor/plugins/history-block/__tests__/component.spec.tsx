import type { EventEmitterValue } from '@/context/event-emitter'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitter } from 'ahooks'
import { EventEmitterContext } from '@/context/event-emitter'
import { UPDATE_HISTORY_EVENT_EMITTER } from '../../../constants'
import HistoryBlockComponent from '../component'
import { HistoryBlockNode } from '../node'

const setup = () => {
  let emit: (event: EventEmitterValue) => void = () => {}
  const onEditRole = vi.fn()
  function Harness() {
    const eventEmitter = useEventEmitter<EventEmitterValue>()
    emit = (event) => eventEmitter.emit(event)
    return (
      <EventEmitterContext.Provider value={{ eventEmitter }}>
        <LexicalComposer
          initialConfig={{
            namespace: 'history-block',
            nodes: [HistoryBlockNode],
            onError: (error) => {
              throw error
            },
          }}
        >
          <HistoryBlockComponent
            nodeKey="history-node"
            roleName={{ user: 'user-role', assistant: 'assistant-role' }}
            onEditRole={onEditRole}
          />
        </LexicalComposer>
      </EventEmitterContext.Provider>
    )
  }
  return { ...render(<Harness />), emit: (event: EventEmitterValue) => emit(event), onEditRole }
}

it('opens role details and invokes editing through keyboard controls', async () => {
  const user = userEvent.setup()
  const { onEditRole } = setup()
  await user.tab()
  expect(screen.getByRole('button', { name: 'common.operation.more' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByText('user-role')).toBeInTheDocument()
  expect(screen.getByText('assistant-role')).toBeInTheDocument()
  const edit = screen.getByRole('button', { name: 'common.promptEditor.history.modal.edit' })
  edit.focus()
  await user.keyboard('{Enter}')
  expect(onEditRole).toHaveBeenCalledOnce()
})

it('applies history updates from the real emitter and ignores unrelated events', async () => {
  const user = userEvent.setup()
  const { emit } = setup()
  await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
  act(() => {
    emit('unrelated')
    emit({ type: 'other-event', payload: { user: 'wrong', assistant: 'wrong' } })
  })
  expect(screen.getByText('user-role')).toBeInTheDocument()
  act(() =>
    emit({
      type: UPDATE_HISTORY_EVENT_EMITTER,
      payload: { user: 'new-user', assistant: 'new-assistant' },
    }),
  )
  expect(screen.getByText('new-user')).toBeInTheDocument()
  expect(screen.getByText('new-assistant')).toBeInTheDocument()
  expect(screen.queryByText('user-role')).not.toBeInTheDocument()
})
