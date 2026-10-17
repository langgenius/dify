import { screen } from '@testing-library/react'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import ChatVariableTrigger from '../chat-variable-trigger'

const mockUseNodesReadOnly = vi.fn()
let chatflowMode = false

vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

vi.mock('@/app/components/workflow/header/chat-variable-button', () => ({
  default: ({ disabled }: { disabled: boolean }) => (
    <button type="button" disabled={disabled}>
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
      chatflowMode = false
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })

      // Act
      render(<ChatVariableTrigger />, {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
      })

      // Assert
      expect(screen.queryByRole('button', { name: 'ChatVariableButton' })).not.toBeInTheDocument()
    })
  })

  // Verifies the disabled state reflects read-only nodes.
  describe('Props', () => {
    it('should render enabled ChatVariableButton when nodes are editable', () => {
      // Arrange
      chatflowMode = true
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })

      // Act
      render(<ChatVariableTrigger />, {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
      })

      // Assert
      expect(screen.getByRole('button', { name: 'ChatVariableButton' })).toBeEnabled()
    })

    it('should render disabled ChatVariableButton when nodes are read-only', () => {
      // Arrange
      chatflowMode = true
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true })

      // Act
      render(<ChatVariableTrigger />, {
        resource: {
          kind: 'app',
          appId: 'app-1',
          mode: chatflowMode ? 'advanced-chat' : 'workflow',
        },
      })

      // Assert
      expect(screen.getByRole('button', { name: 'ChatVariableButton' })).toBeDisabled()
    })
  })
})
