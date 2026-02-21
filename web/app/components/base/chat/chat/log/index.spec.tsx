import type { IChatItem, ThoughtItem } from '@/app/components/base/chat/chat/type'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useStore as useAppStore } from '@/app/components/app/store'
import Log from './index'

vi.mock('@/app/components/app/store', () => ({
  useStore: vi.fn(),
}))

describe('Log', () => {
  const mockSetCurrentLogItem = vi.fn()
  const mockSetShowPromptLogModal = vi.fn()
  const mockSetShowAgentLogModal = vi.fn()
  const mockSetShowMessageLogModal = vi.fn()

  const createLogItem = (overrides?: Partial<IChatItem>): IChatItem => ({
    id: '1',
    content: 'test',
    isAnswer: true, // Required per your IChatItem type
    workflow_run_id: '',
    agent_thoughts: [],
    message_files: [],
    ...overrides,
  })

  beforeEach(() => {
    vi.mocked(useAppStore).mockImplementation(selector => selector({
      // State properties
      appSidebarExpand: 'expand',
      currentLogModalActiveTab: 'question',
      showPromptLogModal: false,
      showAgentLogModal: false,
      showMessageLogModal: false,
      showAppConfigureFeaturesModal: false, // Fixed: Added missing required property
      currentLogItem: null,
      // Action functions
      setCurrentLogItem: mockSetCurrentLogItem,
      setShowPromptLogModal: mockSetShowPromptLogModal,
      setShowAgentLogModal: mockSetShowAgentLogModal,
      setShowMessageLogModal: mockSetShowMessageLogModal,
    } as unknown as Parameters<typeof selector>[0])) // Fixed: Double cast to avoid overlap error
  })

  it('should render correctly', () => {
    render(<Log logItem={createLogItem()} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should show message log modal when workflow_run_id exists', async () => {
    const user = userEvent.setup()
    const logItem = createLogItem({ workflow_run_id: 'run-123' })

    render(<Log logItem={logItem} />)
    const container = screen.getByRole('button').parentElement
    if (container)
      await user.click(container)

    expect(mockSetCurrentLogItem).toHaveBeenCalledWith(logItem)
    expect(mockSetShowMessageLogModal).toHaveBeenCalledWith(true)
  })

  it('should show agent log modal when agent_thoughts exists and workflow_run_id is missing', async () => {
    const user = userEvent.setup()
    const thought: ThoughtItem = {
      id: 't1',
      tool: 'test',
      thought: 'thinking',
      tool_input: '',
      message_id: 'm1',
      conversation_id: 'c1',
      observation: '',
      position: 1,
    }
    const logItem = createLogItem({
      workflow_run_id: '',
      agent_thoughts: [thought],
    })

    render(<Log logItem={logItem} />)
    const container = screen.getByRole('button').parentElement
    if (container)
      await user.click(container)

    expect(mockSetCurrentLogItem).toHaveBeenCalledWith(logItem)
    expect(mockSetShowAgentLogModal).toHaveBeenCalledWith(true)
  })

  it('should show prompt log modal when both workflow_run_id and agent_thoughts are missing', async () => {
    const user = userEvent.setup()
    const logItem = createLogItem({
      workflow_run_id: '',
      agent_thoughts: [],
    })

    render(<Log logItem={logItem} />)
    const container = screen.getByRole('button').parentElement
    if (container)
      await user.click(container)

    expect(mockSetCurrentLogItem).toHaveBeenCalledWith(logItem)
    expect(mockSetShowPromptLogModal).toHaveBeenCalledWith(true)
  })

  it('should prevent event propagation on click', async () => {
    const user = userEvent.setup()

    // 1. Spy on both the standard propagation and the immediate propagation
    const stopPropagationSpy = vi.spyOn(Event.prototype, 'stopPropagation')
    const stopImmediatePropagationSpy = vi.spyOn(Event.prototype, 'stopImmediatePropagation')

    render(<Log logItem={createLogItem()} />)

    // Find the container div that has the onClick handler
    const container = screen.getByRole('button').parentElement

    if (container)
      await user.click(container)

    // 2. Assert that both were called
    expect(stopPropagationSpy).toHaveBeenCalled()
    expect(stopImmediatePropagationSpy).toHaveBeenCalled()

    // 3. Clean up spies (Good practice to avoid interfering with other tests)
    stopPropagationSpy.mockRestore()
    stopImmediatePropagationSpy.mockRestore()
  })
})
