import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ClearAllAnnotationsConfirmModal from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'appAnnotation.table.header.clearAllConfirm': 'Clear all annotations?',
        'common.operation.confirm': 'Confirm',
        'common.operation.cancel': 'Cancel',
      }
      return translations[key] || key
    },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ClearAllAnnotationsConfirmModal', () => {
  // Rendering visibility toggled by isShow flag
  describe('Rendering', () => {
    test('should show confirmation dialog when isShow is true', () => {
      // Arrange
      render(
        <ClearAllAnnotationsConfirmModal
          isShow
          onHide={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('Clear all annotations?')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    })

    test('should not render anything when isShow is false', () => {
      // Arrange
      render(
        <ClearAllAnnotationsConfirmModal
          isShow={false}
          onHide={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )

      // Assert
      expect(screen.queryByText('Clear all annotations?')).not.toBeInTheDocument()
    })
  })

  // User confirms or cancels clearing annotations
  describe('Interactions', () => {
    test('should trigger onHide when cancel is clicked', () => {
      const onHide = vi.fn()
      const onConfirm = vi.fn()
      // Arrange
      render(
        <ClearAllAnnotationsConfirmModal
          isShow
          onHide={onHide}
          onConfirm={onConfirm}
        />,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      // Assert
      expect(onHide).toHaveBeenCalledTimes(1)
      expect(onConfirm).not.toHaveBeenCalled()
    })

    test('should trigger onConfirm when confirm is clicked', () => {
      const onHide = vi.fn()
      const onConfirm = vi.fn()
      // Arrange
      render(
        <ClearAllAnnotationsConfirmModal
          isShow
          onHide={onHide}
          onConfirm={onConfirm}
        />,
      )

      // Act
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

      // Assert
      expect(onConfirm).toHaveBeenCalledTimes(1)
      expect(onHide).not.toHaveBeenCalled()
    })
  })
})
