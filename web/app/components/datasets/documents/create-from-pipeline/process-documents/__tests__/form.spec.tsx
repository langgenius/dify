import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import Toast from '@/app/components/base/toast'

import Form from '../form'

// Mock the Header component (sibling component, not a base component)
vi.mock('../header', () => ({
  default: ({ onReset, resetDisabled, onPreview, previewDisabled }: {
    onReset: () => void
    resetDisabled: boolean
    onPreview: () => void
    previewDisabled: boolean
  }) => (
    <div data-testid="form-header">
      <button data-testid="reset-btn" onClick={onReset} disabled={resetDisabled}>Reset</button>
      <button data-testid="preview-btn" onClick={onPreview} disabled={previewDisabled}>Preview</button>
    </div>
  ),
}))

const schema = z.object({
  name: z.string().min(1, 'Name is required'),
  value: z.string().optional(),
})

const defaultConfigs: BaseConfiguration[] = [
  { variable: 'name', type: 'text-input', label: 'Name', required: true, showConditions: [] } as BaseConfiguration,
  { variable: 'value', type: 'text-input', label: 'Value', required: false, showConditions: [] } as BaseConfiguration,
]

const defaultProps = {
  initialData: { name: 'test', value: '' },
  configurations: defaultConfigs,
  schema,
  onSubmit: vi.fn(),
  onPreview: vi.fn(),
  ref: { current: null },
  isRunning: false,
}

describe('Form (process-documents)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
  })

  // Verify basic rendering of form structure
  describe('Rendering', () => {
    it('should render form with header and fields', () => {
      render(<Form {...defaultProps} />)

      expect(screen.getByTestId('form-header')).toBeInTheDocument()
      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByText('Value')).toBeInTheDocument()
    })

    it('should render all configuration fields', () => {
      const configs: BaseConfiguration[] = [
        { variable: 'a', type: 'text-input', label: 'A', required: false, showConditions: [] } as BaseConfiguration,
        { variable: 'b', type: 'text-input', label: 'B', required: false, showConditions: [] } as BaseConfiguration,
        { variable: 'c', type: 'text-input', label: 'C', required: false, showConditions: [] } as BaseConfiguration,
      ]

      render(<Form {...defaultProps} configurations={configs} initialData={{ a: '', b: '', c: '' }} />)

      expect(screen.getByText('A')).toBeInTheDocument()
      expect(screen.getByText('B')).toBeInTheDocument()
      expect(screen.getByText('C')).toBeInTheDocument()
    })
  })

  // Verify form submission behavior
  describe('Form Submission', () => {
    it('should call onSubmit with valid data on form submit', async () => {
      render(<Form {...defaultProps} />)
      const form = screen.getByTestId('form-header').closest('form')!

      fireEvent.submit(form)

      await waitFor(() => {
        expect(defaultProps.onSubmit).toHaveBeenCalled()
      })
    })

    it('should call onSubmit with valid data via imperative handle', async () => {
      const ref = { current: null as { submit: () => void } | null }
      render(<Form {...defaultProps} ref={ref} />)

      ref.current?.submit()

      await waitFor(() => {
        expect(defaultProps.onSubmit).toHaveBeenCalled()
      })
    })
  })

  // Verify validation shows Toast on error
  describe('Validation', () => {
    it('should show toast error when validation fails', async () => {
      render(<Form {...defaultProps} initialData={{ name: '', value: '' }} />)
      const form = screen.getByTestId('form-header').closest('form')!

      fireEvent.submit(form)

      await waitFor(() => {
        expect(Toast.notify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })
    })

    it('should not show toast error when validation passes', async () => {
      render(<Form {...defaultProps} />)
      const form = screen.getByTestId('form-header').closest('form')!

      fireEvent.submit(form)

      await waitFor(() => {
        expect(defaultProps.onSubmit).toHaveBeenCalled()
      })
      expect(Toast.notify).not.toHaveBeenCalled()
    })
  })

  // Verify header button states
  describe('Header Controls', () => {
    it('should pass isRunning to previewDisabled', () => {
      render(<Form {...defaultProps} isRunning={true} />)

      expect(screen.getByTestId('preview-btn')).toBeDisabled()
    })

    it('should call onPreview when preview button is clicked', () => {
      render(<Form {...defaultProps} />)

      fireEvent.click(screen.getByTestId('preview-btn'))

      expect(defaultProps.onPreview).toHaveBeenCalled()
    })

    it('should render reset button (disabled when form is not dirty)', () => {
      render(<Form {...defaultProps} />)

      // Reset button is rendered but disabled since form is not dirty initially
      expect(screen.getByTestId('reset-btn')).toBeInTheDocument()
      expect(screen.getByTestId('reset-btn')).toBeDisabled()
    })
  })

  // Verify edge cases
  describe('Edge Cases', () => {
    it('should render with empty configurations array', () => {
      render(<Form {...defaultProps} configurations={[]} />)

      expect(screen.getByTestId('form-header')).toBeInTheDocument()
    })

    it('should render with empty initialData', () => {
      render(<Form {...defaultProps} initialData={{}} configurations={[]} />)

      expect(screen.getByTestId('form-header')).toBeInTheDocument()
    })
  })
})
