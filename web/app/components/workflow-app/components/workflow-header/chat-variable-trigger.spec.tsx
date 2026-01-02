import { render, screen } from '@testing-library/react'
import ChatVariableTrigger from './chat-variable-trigger'

const mockUseNodesReadOnly = vi.fn()
const mockUseIsChatMode = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

vi.mock('../../hooks', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
}))

vi.mock('@/app/components/workflow/header/chat-variable-button', () => ({
  default: ({ disabled }: { disabled: boolean }) => (
    <button data-testid="chat-variable-button" type="button" disabled={disabled}>
      ChatVariableButton
    </button>
  ),
}))

describe('ChatVariableTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verifies conditional rendering when chat mode is off.
  describe('Rendering', () => {
    it('should not render when not in chat mode', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(false)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })

      // Act
      render(<ChatVariableTrigger />)

      // Assert
      expect(screen.queryByRole('button', { name: 'ChatVariableButton' })).not.toBeInTheDocument()
    })
  })

  // Verifies the disabled state reflects read-only nodes.
  describe('Props', () => {
    it('should render enabled ChatVariableButton when nodes are editable', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(true)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })

      // Act
      render(<ChatVariableTrigger />)

      // Assert
      expect(screen.getByRole('button', { name: 'ChatVariableButton' })).toBeEnabled()
    })

    it('should render disabled ChatVariableButton when nodes are read-only', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(true)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true })

      // Act
      render(<ChatVariableTrigger />)

      // Assert
      expect(screen.getByRole('button', { name: 'ChatVariableButton' })).toBeDisabled()
    })
  })
})
