import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ConfigurationsSection from './configurations-section'

describe('ConfigurationsSection', () => {
  const defaultProps = {
    timeout: 30,
    onTimeoutChange: vi.fn(),
    sseReadTimeout: 300,
    onSseReadTimeoutChange: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<ConfigurationsSection {...defaultProps} />)
      expect(screen.getByDisplayValue('30')).toBeInTheDocument()
      expect(screen.getByDisplayValue('300')).toBeInTheDocument()
    })

    it('should render timeout input with correct value', () => {
      render(<ConfigurationsSection {...defaultProps} />)
      const timeoutInput = screen.getByDisplayValue('30')
      expect(timeoutInput).toHaveAttribute('type', 'number')
    })

    it('should render SSE read timeout input with correct value', () => {
      render(<ConfigurationsSection {...defaultProps} />)
      const sseInput = screen.getByDisplayValue('300')
      expect(sseInput).toHaveAttribute('type', 'number')
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
      expect(screen.getByDisplayValue('60')).toBeInTheDocument()
    })

    it('should display custom SSE read timeout value', () => {
      render(<ConfigurationsSection {...defaultProps} sseReadTimeout={600} />)
      expect(screen.getByDisplayValue('600')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onTimeoutChange when timeout input changes', () => {
      const onTimeoutChange = vi.fn()
      render(<ConfigurationsSection {...defaultProps} onTimeoutChange={onTimeoutChange} />)

      const timeoutInput = screen.getByDisplayValue('30')
      fireEvent.change(timeoutInput, { target: { value: '45' } })

      expect(onTimeoutChange).toHaveBeenCalledWith(45)
    })

    it('should call onSseReadTimeoutChange when SSE timeout input changes', () => {
      const onSseReadTimeoutChange = vi.fn()
      render(<ConfigurationsSection {...defaultProps} onSseReadTimeoutChange={onSseReadTimeoutChange} />)

      const sseInput = screen.getByDisplayValue('300')
      fireEvent.change(sseInput, { target: { value: '500' } })

      expect(onSseReadTimeoutChange).toHaveBeenCalledWith(500)
    })

    it('should handle numeric conversion correctly', () => {
      const onTimeoutChange = vi.fn()
      render(<ConfigurationsSection {...defaultProps} onTimeoutChange={onTimeoutChange} />)

      const timeoutInput = screen.getByDisplayValue('30')
      fireEvent.change(timeoutInput, { target: { value: '0' } })

      expect(onTimeoutChange).toHaveBeenCalledWith(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle zero timeout value', () => {
      render(<ConfigurationsSection {...defaultProps} timeout={0} />)
      expect(screen.getByDisplayValue('0')).toBeInTheDocument()
    })

    it('should handle zero SSE read timeout value', () => {
      render(<ConfigurationsSection {...defaultProps} sseReadTimeout={0} />)
      expect(screen.getByDisplayValue('0')).toBeInTheDocument()
    })

    it('should handle large timeout values', () => {
      render(<ConfigurationsSection {...defaultProps} timeout={9999} sseReadTimeout={9999} />)
      expect(screen.getAllByDisplayValue('9999')).toHaveLength(2)
    })
  })
})
