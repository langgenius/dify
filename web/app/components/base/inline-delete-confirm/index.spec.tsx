import { cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { createReactI18nextMock } from '@/test/i18n-mock'
import InlineDeleteConfirm from './index'

// Mock react-i18next with custom translations for test assertions
vi.mock('react-i18next', () => createReactI18nextMock({
  'operation.deleteConfirmTitle': 'Delete?',
  'operation.yes': 'Yes',
  'operation.no': 'No',
  'operation.confirmAction': 'Please confirm your action.',
}))

afterEach(cleanup)

describe('InlineDeleteConfirm', () => {
  describe('Rendering', () => {
    it('should render with default text', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      expect(getByText('Delete?')).toBeInTheDocument()
      expect(getByText('No')).toBeInTheDocument()
      expect(getByText('Yes')).toBeInTheDocument()
    })

    it('should render with custom text', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByText } = render(
        <InlineDeleteConfirm
          title="Remove?"
          confirmText="Confirm"
          cancelText="Cancel"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )

      expect(getByText('Remove?')).toBeInTheDocument()
      expect(getByText('Cancel')).toBeInTheDocument()
      expect(getByText('Confirm')).toBeInTheDocument()
    })

    it('should have proper ARIA attributes', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { container } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveAttribute('aria-labelledby', 'inline-delete-confirm-title')
      expect(wrapper).toHaveAttribute('aria-describedby', 'inline-delete-confirm-description')
    })
  })

  describe('Button interactions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      fireEvent.click(getByText('No'))
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should call onConfirm when confirm button is clicked', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      fireEvent.click(getByText('Yes'))
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('Variant prop', () => {
    it('should render with delete variant by default', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      const confirmButton = getByText('Yes').closest('button')
      expect(confirmButton?.className).toContain('btn-destructive')
    })

    it('should render without destructive class for warning variant', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByText } = render(
        <InlineDeleteConfirm
          variant="warning"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )

      const confirmButton = getByText('Yes').closest('button')
      expect(confirmButton?.className).not.toContain('btn-destructive')
    })

    it('should render without destructive class for info variant', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByText } = render(
        <InlineDeleteConfirm
          variant="info"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )

      const confirmButton = getByText('Yes').closest('button')
      expect(confirmButton?.className).not.toContain('btn-destructive')
    })
  })

  describe('Custom className', () => {
    it('should apply custom className to wrapper', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { container } = render(
        <InlineDeleteConfirm
          className="custom-class"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper.className).toContain('custom-class')
    })
  })
})
