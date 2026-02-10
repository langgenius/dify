import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import ResultItemFooter from './result-item-footer'

describe('ResultItemFooter', () => {
  const mockShowDetailModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the result item footer
  describe('Rendering', () => {
    it('should render the document title', () => {
      // Arrange & Act
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="My Document.pdf"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Assert
      expect(screen.getByText('My Document.pdf')).toBeInTheDocument()
    })

    it('should render the "open" button text', () => {
      // Arrange & Act
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.pdf}
          docTitle="File.pdf"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Assert
      expect(screen.getByText(/open/i)).toBeInTheDocument()
    })

    it('should render the file icon', () => {
      // Arrange & Act
      const { container } = render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="File.txt"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Assert
      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  // User interaction tests
  describe('User Interactions', () => {
    it('should call showDetailModal when open button is clicked', () => {
      // Arrange
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="Doc"
          showDetailModal={mockShowDetailModal}
        />,
      )

      // Act
      const openButton = screen.getByText(/open/i).closest('.cursor-pointer') as HTMLElement
      fireEvent.click(openButton)

      // Assert
      expect(mockShowDetailModal).toHaveBeenCalledTimes(1)
    })
  })
})
