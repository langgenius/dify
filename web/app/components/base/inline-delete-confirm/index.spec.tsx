import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import InlineDeleteConfirm from './index'

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common.operation.deleteConfirmTitle': 'Delete?',
        'common.operation.yes': 'Yes',
        'common.operation.no': 'No',
        'common.operation.confirmAction': 'Please confirm your action.',
      }
      return translations[key] || key
    },
  }),
}))

afterEach(cleanup)

describe('InlineDeleteConfirm', () => {
  describe('Rendering', () => {
    test('should render with default text', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      expect(getByText('Delete?')).toBeInTheDocument()
      expect(getByText('No')).toBeInTheDocument()
      expect(getByText('Yes')).toBeInTheDocument()
    })

    test('should render with custom text', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
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

    test('should have proper ARIA attributes', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
      const { container } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveAttribute('aria-labelledby', 'inline-delete-confirm-title')
      expect(wrapper).toHaveAttribute('aria-describedby', 'inline-delete-confirm-description')
    })
  })

  describe('Button interactions', () => {
    test('should call onCancel when cancel button is clicked', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      fireEvent.click(getByText('No'))
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    test('should call onConfirm when confirm button is clicked', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      fireEvent.click(getByText('Yes'))
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  describe('Variant prop', () => {
    test('should render with delete variant by default', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
      const { getByText } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      const confirmButton = getByText('Yes').closest('button')
      expect(confirmButton?.className).toContain('btn-destructive')
    })

    test('should render without destructive class for warning variant', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
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

    test('should render without destructive class for info variant', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
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
    test('should apply custom className to wrapper', () => {
      const onConfirm = jest.fn()
      const onCancel = jest.fn()
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
