import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import ResultItemFooter from '../result-item-footer'

describe('ResultItemFooter', () => {
  const mockShowDetailModal = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the result item footer
  describe('Rendering', () => {
    it('should render the document title', () => {
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="My Document.pdf"
          showDetailModal={mockShowDetailModal}
        />,
      )

      expect(screen.getByText('My Document.pdf')).toBeInTheDocument()
    })

    it('should render the "open" button text', () => {
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.pdf}
          docTitle="File.pdf"
          showDetailModal={mockShowDetailModal}
        />,
      )

      expect(screen.getByText(/open/i)).toBeInTheDocument()
    })

    it('should render the file icon', () => {
      const { container } = render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="File.txt"
          showDetailModal={mockShowDetailModal}
        />,
      )

      const icon = container.querySelector('svg')
      expect(icon).toBeInTheDocument()
    })
  })

  // User interaction tests
  describe('User Interactions', () => {
    it('should call showDetailModal when open button is clicked', () => {
      render(
        <ResultItemFooter
          docType={FileAppearanceTypeEnum.document}
          docTitle="Doc"
          showDetailModal={mockShowDetailModal}
        />,
      )

      const openButton = screen.getByText(/open/i)
      fireEvent.click(openButton)

      expect(mockShowDetailModal).toHaveBeenCalledTimes(1)
    })
  })
})
