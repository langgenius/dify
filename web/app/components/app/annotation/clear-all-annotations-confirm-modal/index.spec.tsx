import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import ClearAllAnnotationsConfirmModal from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      const translations: Record<string, string> = {
        'table.header.clearAllConfirm': 'Clear all annotations?',
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

describe('ClearAllAnnotationsConfirmModal', () => {
  // Rendering visibility toggled by isShow flag
  describe('Rendering', () => {
    it('should show confirmation dialog when isShow is true', () => {
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

    it('should not render anything when isShow is false', () => {
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
    it('should trigger onHide when cancel is clicked', () => {
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

    it('should trigger onConfirm when confirm is clicked', () => {
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
