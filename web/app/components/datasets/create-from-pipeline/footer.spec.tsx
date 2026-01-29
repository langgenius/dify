import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import Footer from './footer'

// Configurable mock for search params
let mockSearchParams = new URLSearchParams()
const mockReplace = vi.fn()

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}))

// Mock service hook
const mockInvalidDatasetList = vi.fn()
vi.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

// Mock CreateFromDSLModal to capture props
let capturedActiveTab: string | undefined
let capturedDslUrl: string | undefined

vi.mock('./create-options/create-from-dsl-modal', () => ({
  default: ({ show, onClose, onSuccess, activeTab, dslUrl }: {
    show: boolean
    onClose: () => void
    onSuccess: () => void
    activeTab?: string
    dslUrl?: string
  }) => {
    capturedActiveTab = activeTab
    capturedDslUrl = dslUrl
    return show
      ? (
          <div data-testid="dsl-modal">
            <button data-testid="close-modal" onClick={onClose}>Close</button>
            <button data-testid="success-modal" onClick={onSuccess}>Success</button>
          </div>
        )
      : null
  },
  CreateFromDSLModalTab: {
    FROM_URL: 'FROM_URL',
    FROM_FILE: 'FROM_FILE',
  },
}))

// ============================================================================
// Footer Component Tests
// ============================================================================

describe('Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    capturedActiveTab = undefined
    capturedDslUrl = undefined
  })

  // --------------------------------------------------------------------------
  // Rendering Tests
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Footer />)
      expect(screen.getByText(/importDSL/i)).toBeInTheDocument()
    })

    it('should render import button with icon', () => {
      const { container } = render(<Footer />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should not show modal initially', () => {
      render(<Footer />)
      expect(screen.queryByTestId('dsl-modal')).not.toBeInTheDocument()
    })

    it('should render divider', () => {
      const { container } = render(<Footer />)
      const divider = container.querySelector('[class*="w-8"]')
      expect(divider).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // User Interactions Tests
  // --------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should open modal when import button is clicked', () => {
      render(<Footer />)

      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()
    })

    it('should close modal when onClose is called', () => {
      render(<Footer />)

      // Open modal
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)
      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()

      // Close modal
      const closeButton = screen.getByTestId('close-modal')
      fireEvent.click(closeButton)
      expect(screen.queryByTestId('dsl-modal')).not.toBeInTheDocument()
    })

    it('should call invalidDatasetList on success', () => {
      render(<Footer />)

      // Open modal
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      // Trigger success
      const successButton = screen.getByTestId('success-modal')
      fireEvent.click(successButton)

      expect(mockInvalidDatasetList).toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Layout Tests
  // --------------------------------------------------------------------------
  describe('Layout', () => {
    it('should have proper container classes', () => {
      const { container } = render(<Footer />)
      const footerDiv = container.firstChild as HTMLElement
      expect(footerDiv).toHaveClass('absolute', 'bottom-0', 'left-0', 'right-0', 'z-10')
    })

    it('should have backdrop blur effect', () => {
      const { container } = render(<Footer />)
      const footerDiv = container.firstChild as HTMLElement
      expect(footerDiv).toHaveClass('backdrop-blur-[6px]')
    })
  })

  // --------------------------------------------------------------------------
  // Memoization Tests
  // --------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const { rerender } = render(<Footer />)
      rerender(<Footer />)
      expect(screen.getByText(/importDSL/i)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // URL Parameter Tests (Branch Coverage)
  // --------------------------------------------------------------------------
  describe('URL Parameter Handling', () => {
    it('should set activeTab to FROM_URL when dslUrl is present', () => {
      mockSearchParams = new URLSearchParams('remoteInstallUrl=https://example.com/dsl')

      render(<Footer />)

      // Open modal to trigger prop capture
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      expect(capturedActiveTab).toBe('FROM_URL')
      expect(capturedDslUrl).toBe('https://example.com/dsl')
    })

    it('should set activeTab to undefined when dslUrl is not present', () => {
      mockSearchParams = new URLSearchParams()

      render(<Footer />)

      // Open modal to trigger prop capture
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      expect(capturedActiveTab).toBeUndefined()
      expect(capturedDslUrl).toBeUndefined()
    })

    it('should call replace when closing modal with dslUrl present', () => {
      mockSearchParams = new URLSearchParams('remoteInstallUrl=https://example.com/dsl')

      render(<Footer />)

      // Open modal
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)
      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()

      // Close modal
      const closeButton = screen.getByTestId('close-modal')
      fireEvent.click(closeButton)

      expect(mockReplace).toHaveBeenCalledWith('/datasets/create-from-pipeline')
    })

    it('should not call replace when closing modal without dslUrl', () => {
      mockSearchParams = new URLSearchParams()

      render(<Footer />)

      // Open modal
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      // Close modal
      const closeButton = screen.getByTestId('close-modal')
      fireEvent.click(closeButton)

      expect(mockReplace).not.toHaveBeenCalled()
    })
  })
})
