import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import RemoveAnnotationConfirmModal from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      const translations: Record<string, string> = {
        'feature.annotation.removeConfirm': 'Remove annotation?',
        'operation.confirm': 'Confirm',
        'operation.cancel': 'Cancel',
      }
      if (translations[key])
        return translations[key]
      const prefix = options?.ns ? `${options.ns}.` : ''
      return `${prefix}${key}`
    },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RemoveAnnotationConfirmModal', () => {
  // Rendering behavior driven by isShow and translations
  describe('Rendering', () => {
    it('should display the confirm modal when visible', () => {
      // Arrange
      render(
        <RemoveAnnotationConfirmModal
          isShow
          onHide={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('Remove annotation?')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    })

    it('should not render modal content when hidden', () => {
      // Arrange
      render(
        <RemoveAnnotationConfirmModal
          isShow={false}
          onHide={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.queryByText('Remove annotation?')).not.toBeInTheDocument()
    })
  })

  // User interactions with confirm and cancel buttons
  describe('Interactions', () => {
    it('should call onHide when cancel button is clicked', () => {
      const onHide = vi.fn()
      const onRemove = vi.fn()
      // Arrange
      render(
        <RemoveAnnotationConfirmModal
          isShow
          onHide={onHide}
          onRemove={onRemove}
        />,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      // Assert
      expect(onHide).toHaveBeenCalledTimes(1)
      expect(onRemove).not.toHaveBeenCalled()
    })

    it('should call onRemove when confirm button is clicked', () => {
      const onHide = vi.fn()
      const onRemove = vi.fn()
      // Arrange
      render(
        <RemoveAnnotationConfirmModal
          isShow
          onHide={onHide}
          onRemove={onRemove}
        />,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

      // Assert
      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(onHide).not.toHaveBeenCalled()
    })
  })
})
