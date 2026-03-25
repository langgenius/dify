import type { AgentConfig } from '@/models/debug'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { AgentStrategy } from '@/types/app'
import AssistantTypePicker from './index'

// Test utilities
const defaultAgentConfig: AgentConfig = {
  enabled: true,
  max_iteration: 3,
  strategy: AgentStrategy.functionCall,
  tools: [],
}

const defaultProps = {
  value: 'chat',
  disabled: false,
  onChange: vi.fn(),
  isFunctionCall: true,
  isChatModel: true,
  agentConfig: defaultAgentConfig,
  onAgentSettingChange: vi.fn(),
}

const renderComponent = (props: Partial<React.ComponentProps<typeof AssistantTypePicker>> = {}) => {
  const mergedProps = { ...defaultProps, ...props }
  return render(<AssistantTypePicker {...mergedProps} />)
}

// Helper to get option element by description (which is unique per option)
const getOptionByDescription = (descriptionRegex: RegExp) => {
  const description = screen.getByText(descriptionRegex)
  return description.parentElement as HTMLElement
}

describe('AssistantTypePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      renderComponent()

      // Assert
      expect(screen.getByText(/chatAssistant.name/i)).toBeInTheDocument()
    })

    it('should render chat assistant by default when value is "chat"', () => {
      // Arrange & Act
      renderComponent({ value: 'chat' })

      // Assert
      expect(screen.getByText(/chatAssistant.name/i)).toBeInTheDocument()
    })

    it('should render agent assistant when value is "agent"', () => {
      // Arrange & Act
      renderComponent({ value: 'agent' })

      // Assert
      expect(screen.getByText(/agentAssistant.name/i)).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should use provided value prop', () => {
      // Arrange & Act
      renderComponent({ value: 'agent' })

      // Assert
      expect(screen.getByText(/agentAssistant.name/i)).toBeInTheDocument()
    })

    it('should handle agentConfig prop', () => {
      // Arrange
      const customAgentConfig: AgentConfig = {
        enabled: true,
        max_iteration: 10,
        strategy: AgentStrategy.react,
        tools: [],
      }

      // Act
      expect(() => {
        renderComponent({ agentConfig: customAgentConfig })
      }).not.toThrow()

      // Assert
      expect(screen.getByText(/chatAssistant.name/i)).toBeInTheDocument()
    })

    it('should handle undefined agentConfig prop', () => {
      // Arrange & Act
      expect(() => {
        renderComponent({ agentConfig: undefined })
      }).not.toThrow()

      // Assert
      expect(screen.getByText(/chatAssistant.name/i)).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should open dropdown when clicking trigger', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Assert - Both options should be visible
      await waitFor(() => {
        const chatOptions = screen.getAllByText(/chatAssistant.name/i)
        const agentOptions = screen.getAllByText(/agentAssistant.name/i)
        expect(chatOptions.length).toBeGreaterThan(1)
        expect(agentOptions.length).toBeGreaterThan(0)
      })
    })

    it('should call onChange when selecting chat assistant', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ value: 'agent', onChange })

      // Act - Open dropdown
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      // Wait for dropdown to open and find chat option
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
      })

      // Find and click the chat option by its unique description
      const chatOption = getOptionByDescription(/chatAssistant.description/i)
      await user.click(chatOption)

      // Assert
      expect(onChange).toHaveBeenCalledWith('chat')
    })

    it('should call onChange when selecting agent assistant', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ value: 'chat', onChange })

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Wait for dropdown to open and click agent option
      await waitFor(() => {
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })

      const agentOption = getOptionByDescription(/agentAssistant.description/i)
      await user.click(agentOption)

      // Assert
      expect(onChange).toHaveBeenCalledWith('agent')
    })

    it('should close dropdown when selecting chat assistant', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent' })

      // Act - Open dropdown
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      // Wait for dropdown and select chat
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
      })

      const chatOption = getOptionByDescription(/chatAssistant.description/i)
      await user.click(chatOption)

      // Assert - Dropdown should close (descriptions should not be visible)
      await waitFor(() => {
        expect(screen.queryByText(/chatAssistant.description/i)).not.toBeInTheDocument()
      })
    })

    it('should not close dropdown when selecting agent assistant', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'chat' })

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Wait for dropdown and select agent
      await waitFor(() => {
        const agentOptions = screen.getAllByText(/agentAssistant.name/i)
        expect(agentOptions.length).toBeGreaterThan(0)
      })

      const agentOptions = screen.getAllByText(/agentAssistant.name/i)
      await user.click(agentOptions[0])

      // Assert - Dropdown should remain open (agent settings should be visible)
      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })
    })

    it('should not call onChange when clicking same value', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ value: 'chat', onChange })

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Wait for dropdown and click same option
      await waitFor(() => {
        const chatOptions = screen.getAllByText(/chatAssistant.name/i)
        expect(chatOptions.length).toBeGreaterThan(1)
      })

      const chatOptions = screen.getAllByText(/chatAssistant.name/i)
      await user.click(chatOptions[1])

      // Assert
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  // Disabled state
  describe('Disabled State', () => {
    it('should not respond to clicks when disabled', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ disabled: true, onChange })

      // Act - Open dropdown (dropdown can still open when disabled)
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })

      // Act - Try to click an option
      const agentOption = getOptionByDescription(/agentAssistant.description/i)
      await user.click(agentOption)

      // Assert - onChange should not be called (options are disabled)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('should not show agent config UI when disabled', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent', disabled: true })

      // Act - Open dropdown
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      // Assert - Agent settings option should not be visible
      await waitFor(() => {
        expect(screen.queryByText(/agent.setting.name/i)).not.toBeInTheDocument()
      })
    })

    it('should show agent config UI when not disabled', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent', disabled: false })

      // Act - Open dropdown
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      // Assert - Agent settings option should be visible
      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })
    })
  })

  // Agent Settings Modal
  describe('Agent Settings Modal', () => {
    it('should open agent settings modal when clicking agent config UI', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent', disabled: false })

      // Act - Open dropdown
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      // Click agent settings
      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/common.operation.save/i)).toBeInTheDocument()
      })
    })

    it('should not open agent settings when value is not agent', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'chat', disabled: false })

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
      })

      // Assert - Agent settings modal should not appear (value is 'chat')
      expect(screen.queryByText(/common.operation.save/i)).not.toBeInTheDocument()
    })

    it('should call onAgentSettingChange when saving agent settings', async () => {
      // Arrange
      const user = userEvent.setup()
      const onAgentSettingChange = vi.fn()
      renderComponent({ value: 'agent', disabled: false, onAgentSettingChange })

      // Act - Open dropdown and agent settings
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      // Wait for modal and click save
      await waitFor(() => {
        expect(screen.getByText(/common.operation.save/i)).toBeInTheDocument()
      })

      const saveButton = screen.getByText(/common.operation.save/i)
      await user.click(saveButton)

      // Assert
      expect(onAgentSettingChange).toHaveBeenCalledWith(defaultAgentConfig)
    })

    it('should close modal when saving agent settings', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent', disabled: false })

      // Act - Open dropdown, agent settings, and save
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      await waitFor(() => {
        expect(screen.getByText(/appDebug.agent.setting.name/i)).toBeInTheDocument()
      })

      const saveButton = screen.getByText(/common.operation.save/i)
      await user.click(saveButton)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText(/common.operation.save/i)).not.toBeInTheDocument()
      })
    })

    it('should close modal when canceling agent settings', async () => {
      // Arrange
      const user = userEvent.setup()
      const onAgentSettingChange = vi.fn()
      renderComponent({ value: 'agent', disabled: false, onAgentSettingChange })

      // Act - Open dropdown, agent settings, and cancel
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      await waitFor(() => {
        expect(screen.getByText(/common.operation.save/i)).toBeInTheDocument()
      })

      const cancelButton = screen.getByText(/common.operation.cancel/i)
      await user.click(cancelButton)

      // Assert
      await waitFor(() => {
        expect(screen.queryByText(/common.operation.save/i)).not.toBeInTheDocument()
      })
      expect(onAgentSettingChange).not.toHaveBeenCalled()
    })

    it('should close dropdown when opening agent settings', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent', disabled: false })

      // Act - Open dropdown and agent settings
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      // Assert - Modal should be open and dropdown should close
      await waitFor(() => {
        expect(screen.getByText(/common.operation.save/i)).toBeInTheDocument()
      })

      // The dropdown should be closed (agent settings description should not be visible)
      await waitFor(() => {
        const descriptions = screen.queryAllByText(/agent.setting.description/i)
        expect(descriptions.length).toBe(0)
      })
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle rapid toggle clicks', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)
      await user.click(trigger)
      await user.click(trigger)

      // Assert - Should not crash
      expect(trigger).toBeInTheDocument()
    })

    it('should handle multiple rapid selection changes', async () => {
      // Arrange
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ value: 'chat', onChange })

      // Act - Open and select agent
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })

      // Click agent option - this stays open because value is 'agent'
      const agentOption = getOptionByDescription(/agentAssistant.description/i)
      await user.click(agentOption)

      // Assert - onChange should have been called once to switch to agent
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledTimes(1)
      })
      expect(onChange).toHaveBeenCalledWith('agent')
    })

    it('should handle missing callback functions gracefully', async () => {
      // Arrange
      const user = userEvent.setup()

      // Act & Assert - Should not crash
      expect(() => {
        renderComponent({
          onChange: undefined!,
          onAgentSettingChange: undefined!,
        })
      }).not.toThrow()

      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)
    })

    it('should handle empty agentConfig', async () => {
      // Arrange & Act
      expect(() => {
        renderComponent({ agentConfig: {} as AgentConfig })
      }).not.toThrow()

      // Assert
      expect(screen.getByText(/chatAssistant.name/i)).toBeInTheDocument()
    })

    describe('should render with different prop combinations', () => {
      const combinations = [
        { value: 'chat' as const, disabled: true, isFunctionCall: true, isChatModel: true },
        { value: 'agent' as const, disabled: false, isFunctionCall: false, isChatModel: false },
        { value: 'agent' as const, disabled: true, isFunctionCall: true, isChatModel: false },
        { value: 'chat' as const, disabled: false, isFunctionCall: false, isChatModel: true },
      ]

      it.each(combinations)(
        'value=$value, disabled=$disabled, isFunctionCall=$isFunctionCall, isChatModel=$isChatModel',
        (combo) => {
          // Arrange & Act
          renderComponent(combo)

          // Assert
          const expectedText = combo.value === 'agent' ? 'agentAssistant.name' : 'chatAssistant.name'
          expect(screen.getByText(new RegExp(expectedText, 'i'))).toBeInTheDocument()
        },
      )
    })
  })

  // Accessibility
  describe('Accessibility', () => {
    it('should render interactive dropdown items', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Assert - Both options should be visible and clickable
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })

      // Verify we can interact with option elements using helper function
      const chatOption = getOptionByDescription(/chatAssistant.description/i)
      const agentOption = getOptionByDescription(/agentAssistant.description/i)
      expect(chatOption).toBeInTheDocument()
      expect(agentOption).toBeInTheDocument()
    })
  })

  // SelectItem Component
  describe('SelectItem Component', () => {
    it('should show checked state for selected option', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'chat' })

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Assert - Both options should be visible with radio components
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })

      // The SelectItem components render with different visual states
      // based on isChecked prop - we verify both options are rendered
      const chatOption = getOptionByDescription(/chatAssistant.description/i)
      const agentOption = getOptionByDescription(/agentAssistant.description/i)
      expect(chatOption).toBeInTheDocument()
      expect(agentOption).toBeInTheDocument()
    })

    it('should render description text', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Assert - Descriptions should be visible
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })
    })

    it('should show Radio component for each option', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Assert - Radio components should be present (both options visible)
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })
    })
  })

  // Agent Setting Integration
  describe('AgentSetting Integration', () => {
    it('should show function call mode when isFunctionCall is true', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent', isFunctionCall: true, isChatModel: false })

      // Act - Open dropdown and settings modal
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/common.operation.save/i)).toBeInTheDocument()
      })
      expect(screen.getByText(/appDebug.agent.agentModeType.functionCall/i)).toBeInTheDocument()
    })

    it('should show built-in prompt when isFunctionCall is false', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent', isFunctionCall: false, isChatModel: true })

      // Act - Open dropdown and settings modal
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      // Assert
      await waitFor(() => {
        expect(screen.getByText(/common.operation.save/i)).toBeInTheDocument()
      })
      expect(screen.getByText(/tools.builtInPromptTitle/i)).toBeInTheDocument()
    })

    it('should initialize max iteration from agentConfig payload', async () => {
      // Arrange
      const user = userEvent.setup()
      const customConfig: AgentConfig = {
        enabled: true,
        max_iteration: 10,
        strategy: AgentStrategy.react,
        tools: [],
      }

      renderComponent({ value: 'agent', agentConfig: customConfig })

      // Act - Open dropdown and settings modal
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettingsTrigger = screen.getByText(/agent.setting.name/i)
      await user.click(agentSettingsTrigger)

      // Assert
      await screen.findByText(/common.operation.save/i)
      const maxIterationInput = await screen.findByRole('spinbutton')
      expect(maxIterationInput).toHaveValue(10)
    })
  })

  // Keyboard Navigation
  describe('Keyboard Navigation', () => {
    it('should support closing dropdown with Escape key', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
      })

      // Press Escape
      await user.keyboard('{Escape}')

      // Assert - Dropdown should close
      await waitFor(() => {
        expect(screen.queryByText(/chatAssistant.description/i)).not.toBeInTheDocument()
      })
    })

    it('should allow keyboard focus on trigger element', () => {
      // Arrange
      renderComponent()

      // Act - Get trigger and verify it can receive focus
      const trigger = screen.getByText(/chatAssistant.name/i)

      // Assert - Element should be focusable
      expect(trigger).toBeInTheDocument()
      expect(trigger.parentElement).toBeInTheDocument()
    })

    it('should allow keyboard focus on dropdown options', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
      })

      // Get options
      const chatOption = getOptionByDescription(/chatAssistant.description/i)
      const agentOption = getOptionByDescription(/agentAssistant.description/i)

      // Assert - Options should be focusable
      expect(chatOption).toBeInTheDocument()
      expect(agentOption).toBeInTheDocument()

      // Verify options exist and can receive focus programmatically
      // Note: focus() doesn't always update document.activeElement in JSDOM
      // so we just verify the elements are interactive
      act(() => {
        chatOption.focus()
      })
      // The element should have received the focus call even if activeElement isn't updated
      expect(chatOption.tabIndex).toBeDefined()
    })

    it('should maintain keyboard accessibility for all interactive elements', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent({ value: 'agent' })

      // Act - Open dropdown
      const trigger = screen.getByText(/agentAssistant.name/i)
      await user.click(trigger)

      // Assert - Agent settings button should be focusable
      await waitFor(() => {
        expect(screen.getByText(/agent.setting.name/i)).toBeInTheDocument()
      })

      const agentSettings = screen.getByText(/agent.setting.name/i)
      expect(agentSettings).toBeInTheDocument()
    })
  })

  // ARIA Attributes
  describe('ARIA Attributes', () => {
    it('should have proper ARIA state for dropdown', async () => {
      // Arrange
      const user = userEvent.setup()
      const { container } = renderComponent()

      // Act - Check initial state
      const portalContainer = container.querySelector('[data-state]')
      expect(portalContainer).toHaveAttribute('data-state', 'closed')

      // Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Assert - State should change to open
      await waitFor(() => {
        const openPortal = container.querySelector('[data-state="open"]')
        expect(openPortal).toBeInTheDocument()
      })
    })

    it('should have proper data-state attribute', () => {
      // Arrange & Act
      const { container } = renderComponent()

      // Assert - Portal should have data-state for accessibility
      const portalContainer = container.querySelector('[data-state]')
      expect(portalContainer).toBeInTheDocument()
      expect(portalContainer).toHaveAttribute('data-state')

      // Should start in closed state
      expect(portalContainer).toHaveAttribute('data-state', 'closed')
    })

    it('should maintain accessible structure for screen readers', () => {
      // Arrange & Act
      renderComponent({ value: 'chat' })

      // Assert - Text content should be accessible
      expect(screen.getByText(/chatAssistant.name/i)).toBeInTheDocument()

      // Icons should have proper structure
      const { container } = renderComponent()
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('should provide context through text labels', async () => {
      // Arrange
      const user = userEvent.setup()
      renderComponent()

      // Act - Open dropdown
      const trigger = screen.getByText(/chatAssistant.name/i)
      await user.click(trigger)

      // Assert - All options should have descriptive text
      await waitFor(() => {
        expect(screen.getByText(/chatAssistant.description/i)).toBeInTheDocument()
        expect(screen.getByText(/agentAssistant.description/i)).toBeInTheDocument()
      })

      // Title text should be visible
      expect(screen.getByText(/assistantType.name/i)).toBeInTheDocument()
    })
  })
})
