import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConfigurationsSection from '../configurations-section'

describe('ConfigurationsSection', () => {
  const defaultProps = {
    timeout: 30,
    onTimeoutChange: vi.fn(),
    sseReadTimeout: 300,
    onSseReadTimeoutChange: vi.fn(),
  }
  const getVisibleNumberInputs = () => screen.getAllByRole('textbox')
  const getVisibleNumberInput = (index: number) => {
    const input = getVisibleNumberInputs()[index]
    if (!input) throw new Error(`Expected number input at index ${index}`)
    return input
  }
  const getTimeoutInput = () => getVisibleNumberInput(0)
  const getSseReadTimeoutInput = () => getVisibleNumberInput(1)

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ConfigurationsSection {...defaultProps} />)
      expect(getTimeoutInput()).toHaveValue('30')
      expect(getSseReadTimeoutInput()).toHaveValue('300')
    })

    it('should render timeout input with correct value', () => {
      render(<ConfigurationsSection {...defaultProps} />)
      expect(getTimeoutInput()).toHaveValue('30')
    })

    it('should render SSE read timeout input with correct value', () => {
      render(<ConfigurationsSection {...defaultProps} />)
      expect(getSseReadTimeoutInput()).toHaveValue('300')
    })

    it('should render labels for both inputs', () => {
      render(<ConfigurationsSection {...defaultProps} />)
      // i18n keys are rendered as-is in test environment
      expect(screen.getByText('tools.mcp.modal.timeout')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.sseReadTimeout')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display custom timeout value', () => {
      render(<ConfigurationsSection {...defaultProps} timeout={60} />)
      expect(getTimeoutInput()).toHaveValue('60')
    })

    it('should display custom SSE read timeout value', () => {
      render(<ConfigurationsSection {...defaultProps} sseReadTimeout={600} />)
      expect(getSseReadTimeoutInput()).toHaveValue('600')
    })
  })

  describe('User Interactions', () => {
    it('should call onTimeoutChange when timeout input changes', () => {
      const onTimeoutChange = vi.fn()
      render(<ConfigurationsSection {...defaultProps} onTimeoutChange={onTimeoutChange} />)

      const timeoutInput = getTimeoutInput()
      fireEvent.change(timeoutInput, { target: { value: '45' } })

      expect(onTimeoutChange).toHaveBeenCalledWith(45)
    })

    it('should call onSseReadTimeoutChange when SSE timeout input changes', () => {
      const onSseReadTimeoutChange = vi.fn()
      render(
        <ConfigurationsSection {...defaultProps} onSseReadTimeoutChange={onSseReadTimeoutChange} />,
      )

      const sseInput = getSseReadTimeoutInput()
      fireEvent.change(sseInput, { target: { value: '500' } })

      expect(onSseReadTimeoutChange).toHaveBeenCalledWith(500)
    })

    it('should handle numeric conversion correctly', () => {
      const onTimeoutChange = vi.fn()
      render(<ConfigurationsSection {...defaultProps} onTimeoutChange={onTimeoutChange} />)

      const timeoutInput = getTimeoutInput()
      fireEvent.change(timeoutInput, { target: { value: '0' } })

      expect(onTimeoutChange).toHaveBeenCalledWith(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero timeout value', () => {
      render(<ConfigurationsSection {...defaultProps} timeout={0} />)
      expect(getTimeoutInput()).toHaveValue('0')
    })

    it('should handle zero SSE read timeout value', () => {
      render(<ConfigurationsSection {...defaultProps} sseReadTimeout={0} />)
      expect(getSseReadTimeoutInput()).toHaveValue('0')
    })

    it('should handle large timeout values', () => {
      render(<ConfigurationsSection {...defaultProps} timeout={9999} sseReadTimeout={9999} />)
      expect(screen.getAllByDisplayValue('9999')).toHaveLength(2)
    })
  })
})
