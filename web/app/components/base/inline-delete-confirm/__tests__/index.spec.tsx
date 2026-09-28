import { cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import { createReactI18nextMock } from '@/test/i18n-mock'
import InlineDeleteConfirm from '../index'

// Mock react-i18next with custom translations for test assertions
vi.mock('react-i18next', () =>
  createReactI18nextMock({
    'operation.deleteConfirmTitle': 'Delete?',
    'operation.yes': 'Yes',
    'operation.no': 'No',
    'operation.confirmAction': 'Please confirm your action.',
  }),
)

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

    it('should expose the prompt title and description on a semantic group', () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()
      const { getByRole } = render(
        <InlineDeleteConfirm onConfirm={onConfirm} onCancel={onCancel} />,
      )

      const prompt = getByRole('group', { name: 'Delete?' })
      expect(prompt).toHaveAccessibleDescription('Please confirm your action.')
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
})
