import { render, screen } from '@testing-library/react'
import ChatVariableTrigger from './chat-variable-trigger'

const mockUseNodesReadOnly = jest.fn()
const mockUseIsChatMode = jest.fn()

jest.mock('@/app/components/workflow/hooks', () => ({
  __esModule: true,
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

jest.mock('../../hooks', () => ({
  __esModule: true,
  useIsChatMode: () => mockUseIsChatMode(),
}))

jest.mock('@/app/components/workflow/header/chat-variable-button', () => ({
  __esModule: true,
  default: ({ disabled }: { disabled: boolean }) => (
    <button data-testid='chat-variable-button' type='button' disabled={disabled}>
      ChatVariableButton
    </button>
  ),
}))

describe('ChatVariableTrigger', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
      expect(screen.queryByTestId('chat-variable-button')).not.toBeInTheDocument()
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
      expect(screen.getByTestId('chat-variable-button')).toBeEnabled()
    })

    it('should render disabled ChatVariableButton when nodes are read-only', () => {
      // Arrange
      mockUseIsChatMode.mockReturnValue(true)
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true })

      // Act
      render(<ChatVariableTrigger />)

      // Assert
      expect(screen.getByTestId('chat-variable-button')).toBeDisabled()
    })
  })
})
