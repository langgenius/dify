import type { ComponentProps } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MethodSelector from './method-selector'

// Test utilities
const defaultProps: ComponentProps<typeof MethodSelector> = {
  value: 'llm',
  onChange: vi.fn(),
}

const renderComponent = (props: Partial<ComponentProps<typeof MethodSelector>> = {}) => {
  const mergedProps = { ...defaultProps, ...props }
  return render(<MethodSelector {...mergedProps} />)
}

describe('MethodSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderComponent()

      // Should display the current method text
      expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
    })

    it('should render with llm value selected', () => {
      renderComponent({ value: 'llm' })

      expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
    })

    it('should render with form value selected', () => {
      renderComponent({ value: 'form' })

      expect(screen.getByText('tools.createTool.toolInput.methodSetting')).toBeInTheDocument()
    })

    it('should render with undefined value', () => {
      renderComponent({ value: undefined })

      // When value is undefined, it should show the form method text (else branch)
      expect(screen.getByText('tools.createTool.toolInput.methodSetting')).toBeInTheDocument()
    })

    it('should render arrow down icon', () => {
      renderComponent()

      // The arrow icon is rendered with remixicon
      const arrowIcon = document.querySelector('.remixicon')
      expect(arrowIcon).toBeInTheDocument()
    })
  })

  // Props tests
  describe('Props', () => {
    it('should display methodParameter when value is llm', () => {
      renderComponent({ value: 'llm' })

      expect(screen.getByText('tools.createTool.toolInput.methodParameter')).toBeInTheDocument()
    })

    it('should display methodSetting when value is form', () => {
      renderComponent({ value: 'form' })

      expect(screen.getByText('tools.createTool.toolInput.methodSetting')).toBeInTheDocument()
    })

    it('should handle empty string value as non-llm', () => {
      renderComponent({ value: '' })

      expect(screen.getByText('tools.createTool.toolInput.methodSetting')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should open dropdown when trigger is clicked', async () => {
      const user = userEvent.setup()
      renderComponent()

      // Click the trigger to open dropdown
      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      // Dropdown should now show both options with tips
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.toolInput.methodParameterTip')).toBeInTheDocument()
        expect(screen.getByText('tools.createTool.toolInput.methodSettingTip')).toBeInTheDocument()
      })
    })

    it('should call onChange with llm when llm option is clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ value: 'form', onChange })

      // Open dropdown
      const trigger = screen.getByText('tools.createTool.toolInput.methodSetting')
      await user.click(trigger)

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.toolInput.methodParameterTip')).toBeInTheDocument()
      })

      // Click the llm option (by finding the method parameter option in dropdown)
      const llmOption = screen.getAllByText('tools.createTool.toolInput.methodParameter')[0]
      await user.click(llmOption)

      expect(onChange).toHaveBeenCalledWith('llm')
    })

    it('should call onChange with form when form option is clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ value: 'llm', onChange })

      // Open dropdown
      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      // Wait for dropdown to open
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.toolInput.methodSettingTip')).toBeInTheDocument()
      })

      // Click the form option (by finding the method setting option in dropdown)
      const formOption = screen.getAllByText('tools.createTool.toolInput.methodSetting')[0]
      await user.click(formOption)

      expect(onChange).toHaveBeenCalledWith('form')
    })

    it('should toggle dropdown open state', async () => {
      const user = userEvent.setup()
      renderComponent()

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')

      // First click - open
      await user.click(trigger)
      await waitFor(() => {
        expect(screen.getByText('tools.createTool.toolInput.methodParameterTip')).toBeInTheDocument()
      })

      // Second click - close
      await user.click(trigger)
      await waitFor(() => {
        expect(screen.queryByText('tools.createTool.toolInput.methodParameterTip')).not.toBeInTheDocument()
      })
    })
  })

  // Styling tests
  describe('Styling', () => {
    it('should apply hover styles to trigger', () => {
      renderComponent()

      const trigger = document.querySelector('.hover\\:bg-background-section-burn')
      expect(trigger).toBeInTheDocument()
    })

    it('should apply open state styles when dropdown is open', async () => {
      const user = userEvent.setup()
      renderComponent()

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      await waitFor(() => {
        const openTrigger = document.querySelector('.\\!bg-background-section-burn')
        expect(openTrigger).toBeInTheDocument()
      })
    })

    it('should show checkmark for selected llm option', async () => {
      const user = userEvent.setup()
      renderComponent({ value: 'llm' })

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      await waitFor(() => {
        // Check icon should be visible for llm option
        const checkIcon = document.querySelector('.text-text-accent')
        expect(checkIcon).toBeInTheDocument()
      })
    })

    it('should show checkmark for selected form option', async () => {
      const user = userEvent.setup()
      renderComponent({ value: 'form' })

      const trigger = screen.getByText('tools.createTool.toolInput.methodSetting')
      await user.click(trigger)

      await waitFor(() => {
        // Check icon should be visible for form option
        const checkIcon = document.querySelector('.text-text-accent')
        expect(checkIcon).toBeInTheDocument()
      })
    })
  })

  // Dropdown content tests
  describe('Dropdown Content', () => {
    it('should render both method options in dropdown', async () => {
      const user = userEvent.setup()
      renderComponent()

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      await waitFor(() => {
        // Should show both option titles and descriptions
        expect(screen.getByText('tools.createTool.toolInput.methodParameterTip')).toBeInTheDocument()
        expect(screen.getByText('tools.createTool.toolInput.methodSettingTip')).toBeInTheDocument()
      })
    })

    it('should have proper dropdown styling', async () => {
      const user = userEvent.setup()
      renderComponent()

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      await waitFor(() => {
        const dropdown = document.querySelector('.w-\\[320px\\]')
        expect(dropdown).toBeInTheDocument()
        expect(dropdown).toHaveClass('rounded-lg')
        expect(dropdown).toHaveClass('shadow-lg')
      })
    })

    it('should have hover styles on dropdown options', async () => {
      const user = userEvent.setup()
      renderComponent()

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      await waitFor(() => {
        const options = document.querySelectorAll('.hover\\:bg-components-panel-on-panel-item-bg-hover')
        expect(options.length).toBeGreaterThanOrEqual(2)
      })
    })
  })

  // Edge Cases
  describe('Edge Cases', () => {
    it('should handle rapid clicks on trigger', async () => {
      const user = userEvent.setup()
      renderComponent()

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')

      // Rapid clicks
      await user.click(trigger)
      await user.click(trigger)
      await user.click(trigger)

      // Should not crash and should be in a consistent state
      expect(trigger).toBeInTheDocument()
    })

    it('should handle selecting the already selected value', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderComponent({ value: 'llm', onChange })

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      await waitFor(() => {
        expect(screen.getByText('tools.createTool.toolInput.methodParameterTip')).toBeInTheDocument()
      })

      // Click the llm option in the dropdown (the one with the tip text nearby)
      const llmOptionContainer = screen.getByText('tools.createTool.toolInput.methodParameterTip').closest('.cursor-pointer')
      expect(llmOptionContainer).toBeInTheDocument()
      await user.click(llmOptionContainer!)

      // Should call onChange
      expect(onChange).toHaveBeenCalledWith('llm')
    })
  })

  // Accessibility
  describe('Accessibility', () => {
    it('should have clickable trigger area', () => {
      renderComponent()

      const trigger = document.querySelector('.cursor-pointer')
      expect(trigger).toBeInTheDocument()
    })

    it('should have clickable dropdown options', async () => {
      const user = userEvent.setup()
      renderComponent()

      const trigger = screen.getByText('tools.createTool.toolInput.methodParameter')
      await user.click(trigger)

      await waitFor(() => {
        const options = document.querySelectorAll('.cursor-pointer')
        expect(options.length).toBeGreaterThanOrEqual(2)
      })
    })
  })
})
