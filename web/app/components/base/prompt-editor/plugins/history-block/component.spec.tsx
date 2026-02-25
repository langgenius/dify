import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { RoleName } from './index'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UPDATE_HISTORY_EVENT_EMITTER } from '../../constants'
import HistoryBlockComponent from './component'
import { DELETE_HISTORY_BLOCK_COMMAND } from './index'

type HistoryEventPayload = {
  type?: string
  payload?: RoleName
}

type HistorySubscriptionHandler = (payload: HistoryEventPayload) => void

const { mockUseSelectOrDelete, mockUseTrigger, mockUseEventEmitterContextContext } = vi.hoisted(() => ({
  mockUseSelectOrDelete: vi.fn(),
  mockUseTrigger: vi.fn(),
  mockUseEventEmitterContextContext: vi.fn(),
}))

vi.mock('../../hooks', () => ({
  useSelectOrDelete: (...args: unknown[]) => mockUseSelectOrDelete(...args),
  useTrigger: (...args: unknown[]) => mockUseTrigger(...args),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => mockUseEventEmitterContextContext(),
}))

const createRoleName = (overrides?: Partial<RoleName>): RoleName => ({
  user: 'user-role',
  assistant: 'assistant-role',
  ...overrides,
})

const createSelectHookReturn = (isSelected: boolean): [RefObject<HTMLDivElement | null>, boolean] => {
  return [{ current: null }, isSelected]
}

const createTriggerHookReturn = (
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>> = vi.fn() as unknown as Dispatch<SetStateAction<boolean>>,
): [RefObject<HTMLDivElement | null>, boolean, Dispatch<SetStateAction<boolean>>] => {
  return [{ current: null }, open, setOpen]
}

describe('HistoryBlockComponent', () => {
  let subscribedHandler: HistorySubscriptionHandler | null

  beforeEach(() => {
    vi.clearAllMocks()
    subscribedHandler = null

    mockUseSelectOrDelete.mockReturnValue(createSelectHookReturn(false))
    mockUseTrigger.mockReturnValue(createTriggerHookReturn(false))
    const subscribeToHistoryEvents = (handler: HistorySubscriptionHandler) => {
      subscribedHandler = handler
    }
    mockUseEventEmitterContextContext.mockReturnValue({
      eventEmitter: {
        useSubscription: subscribeToHistoryEvents,
      },
    })
  })

  it('should render title and register select or delete hook with node key', () => {
    render(
      <HistoryBlockComponent
        nodeKey="history-node-1"
        onEditRole={vi.fn()}
      />,
    )

    expect(mockUseSelectOrDelete).toHaveBeenCalledWith('history-node-1', DELETE_HISTORY_BLOCK_COMMAND)
    expect(screen.getByText('common.promptEditor.history.item.title')).toBeInTheDocument()
  })

  it('should apply selected and opened classes when selected and popup is open', () => {
    mockUseSelectOrDelete.mockReturnValue(createSelectHookReturn(true))
    mockUseTrigger.mockReturnValue(createTriggerHookReturn(true))

    const { container } = render(
      <HistoryBlockComponent
        nodeKey="history-node-2"
        onEditRole={vi.fn()}
      />,
    )

    const wrapper = container.firstElementChild
    expect(wrapper).toHaveClass('!border-[#F670C7]')
    expect(wrapper).toHaveClass('bg-[#FCE7F6]')
  })

  it('should render modal content when popup is open', () => {
    mockUseTrigger.mockReturnValue(createTriggerHookReturn(true))

    render(
      <HistoryBlockComponent
        nodeKey="history-node-3"
        roleName={createRoleName()}
        onEditRole={vi.fn()}
      />,
    )

    expect(screen.getByText('user-role')).toBeInTheDocument()
    expect(screen.getByText('assistant-role')).toBeInTheDocument()
    expect(screen.getByText('common.promptEditor.history.modal.user')).toBeInTheDocument()
    expect(screen.getByText('common.promptEditor.history.modal.assistant')).toBeInTheDocument()
  })

  it('should call onEditRole when edit action is clicked', async () => {
    const user = userEvent.setup()
    const onEditRole = vi.fn()
    mockUseTrigger.mockReturnValue(createTriggerHookReturn(true))

    render(
      <HistoryBlockComponent
        nodeKey="history-node-4"
        roleName={createRoleName()}
        onEditRole={onEditRole}
      />,
    )

    await user.click(screen.getByText('common.promptEditor.history.modal.edit'))

    expect(onEditRole).toHaveBeenCalledTimes(1)
  })

  it('should update local role names when update history event is received', () => {
    mockUseTrigger.mockReturnValue(createTriggerHookReturn(true))

    render(
      <HistoryBlockComponent
        nodeKey="history-node-5"
        roleName={createRoleName({
          user: 'old-user',
          assistant: 'old-assistant',
        })}
        onEditRole={vi.fn()}
      />,
    )

    expect(screen.getByText('old-user')).toBeInTheDocument()
    expect(screen.getByText('old-assistant')).toBeInTheDocument()
    expect(subscribedHandler).not.toBeNull()

    act(() => {
      subscribedHandler?.({
        type: UPDATE_HISTORY_EVENT_EMITTER,
        payload: {
          user: 'new-user',
          assistant: 'new-assistant',
        },
      })
    })

    expect(screen.getByText('new-user')).toBeInTheDocument()
    expect(screen.getByText('new-assistant')).toBeInTheDocument()
  })

  it('should ignore non history update events from event emitter', () => {
    mockUseTrigger.mockReturnValue(createTriggerHookReturn(true))

    render(
      <HistoryBlockComponent
        nodeKey="history-node-6"
        roleName={createRoleName({
          user: 'kept-user',
          assistant: 'kept-assistant',
        })}
        onEditRole={vi.fn()}
      />,
    )

    expect(subscribedHandler).not.toBeNull()
    act(() => {
      subscribedHandler?.({
        type: 'other-event',
        payload: {
          user: 'updated-user',
          assistant: 'updated-assistant',
        },
      })
    })

    expect(screen.getByText('kept-user')).toBeInTheDocument()
    expect(screen.getByText('kept-assistant')).toBeInTheDocument()
  })

  it('should render when event emitter is unavailable', () => {
    mockUseEventEmitterContextContext.mockReturnValue({
      eventEmitter: undefined,
    })

    render(
      <HistoryBlockComponent
        nodeKey="history-node-7"
        onEditRole={vi.fn()}
      />,
    )

    expect(screen.getByText('common.promptEditor.history.item.title')).toBeInTheDocument()
  })
})
