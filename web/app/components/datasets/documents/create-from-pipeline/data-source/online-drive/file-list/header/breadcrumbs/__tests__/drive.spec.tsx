import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Drive from '../drive'

describe('Drive', () => {
  const defaultProps = {
    breadcrumbs: [] as string[],
    handleBackToRoot: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: button text and separator visibility
  describe('Rendering', () => {
    it('should render "All Files" button text', () => {
      render(<Drive {...defaultProps} />)

      expect(screen.getByRole('button')).toHaveTextContent('datasetPipeline.onlineDrive.breadcrumbs.allFiles')
    })

    it('should show separator "/" when breadcrumbs has items', () => {
      render(<Drive {...defaultProps} breadcrumbs={['Folder A']} />)

      expect(screen.getByText('/')).toBeInTheDocument()
    })

    it('should hide separator when breadcrumbs is empty', () => {
      render(<Drive {...defaultProps} breadcrumbs={[]} />)

      expect(screen.queryByText('/')).not.toBeInTheDocument()
    })
  })

  // Props: disabled state depends on breadcrumbs length
  describe('Props', () => {
    it('should disable button when breadcrumbs is empty', () => {
      render(<Drive {...defaultProps} breadcrumbs={[]} />)

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should enable button when breadcrumbs has items', () => {
      render(<Drive {...defaultProps} breadcrumbs={['Folder A', 'Folder B']} />)

      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })

  // User interactions: clicking the root button
  describe('User Interactions', () => {
    it('should call handleBackToRoot on click when enabled', () => {
      render(<Drive {...defaultProps} breadcrumbs={['Folder A']} />)

      fireEvent.click(screen.getByRole('button'))

      expect(defaultProps.handleBackToRoot).toHaveBeenCalledOnce()
    })
  })
})
