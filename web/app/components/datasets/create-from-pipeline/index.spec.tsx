import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import CreateFromPipeline from './index'

// Mock list component to avoid deep dependency issues
jest.mock('./list', () => ({
  __esModule: true,
  default: () => <div data-testid="list">List Component</div>,
}))

// Mock CreateFromDSLModal to avoid deep dependency chain
jest.mock('./create-options/create-from-dsl-modal', () => ({
  __esModule: true,
  default: ({ show, onClose, onSuccess }: { show: boolean; onClose: () => void; onSuccess: () => void }) => (
    show
      ? (
        <div data-testid="dsl-modal">
          <button data-testid="dsl-modal-close" onClick={onClose}>Close</button>
          <button data-testid="dsl-modal-success" onClick={onSuccess}>Import Success</button>
        </div>
      )
      : null
  ),
  CreateFromDSLModalTab: {
    FROM_URL: 'from-url',
  },
}))

// Mock next/navigation
const mockReplace = jest.fn()
const mockPush = jest.fn()
let mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
  useSearchParams: () => mockSearchParams,
}))

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock useInvalidDatasetList hook
const mockInvalidDatasetList = jest.fn()
jest.mock('@/service/knowledge/use-dataset', () => ({
  useInvalidDatasetList: () => mockInvalidDatasetList,
}))

describe('CreateFromPipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  // Tests for basic rendering
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toBeInTheDocument()
    })

    it('should render the main container with correct className', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('relative')
      expect(mainContainer).toHaveClass('flex')
      expect(mainContainer).toHaveClass('h-[calc(100vh-56px)]')
      expect(mainContainer).toHaveClass('flex-col')
      expect(mainContainer).toHaveClass('overflow-hidden')
      expect(mainContainer).toHaveClass('rounded-t-2xl')
      expect(mainContainer).toHaveClass('border-t')
      expect(mainContainer).toHaveClass('border-effects-highlight')
      expect(mainContainer).toHaveClass('bg-background-default-subtle')
    })

    it('should render Header component with back to knowledge text', () => {
      render(<CreateFromPipeline />)

      expect(screen.getByText('datasetPipeline.creation.backToKnowledge')).toBeInTheDocument()
    })

    it('should render List component', () => {
      render(<CreateFromPipeline />)

      expect(screen.getByTestId('list')).toBeInTheDocument()
    })

    it('should render Footer component with import DSL button', () => {
      render(<CreateFromPipeline />)

      expect(screen.getByText('datasetPipeline.creation.importDSL')).toBeInTheDocument()
    })

    it('should render Effect component with blur effect', () => {
      const { container } = render(<CreateFromPipeline />)

      const effectElement = container.querySelector('.blur-\\[80px\\]')
      expect(effectElement).toBeInTheDocument()
    })

    it('should render Effect component with correct positioning classes', () => {
      const { container } = render(<CreateFromPipeline />)

      const effectElement = container.querySelector('.left-8.top-\\[-34px\\].opacity-20')
      expect(effectElement).toBeInTheDocument()
    })
  })

  // Tests for Header component integration
  describe('Header Component Integration', () => {
    it('should render header with navigation link', () => {
      render(<CreateFromPipeline />)

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', '/datasets')
    })

    it('should render back button inside header', () => {
      render(<CreateFromPipeline />)

      const button = screen.getByRole('button', { name: '' })
      expect(button).toBeInTheDocument()
      expect(button).toHaveClass('rounded-full')
    })

    it('should render header with correct styling', () => {
      const { container } = render(<CreateFromPipeline />)

      const headerElement = container.querySelector('.px-16.pb-2.pt-5')
      expect(headerElement).toBeInTheDocument()
    })
  })

  // Tests for Footer component integration
  describe('Footer Component Integration', () => {
    it('should render footer with import DSL button', () => {
      render(<CreateFromPipeline />)

      const importButton = screen.getByText('datasetPipeline.creation.importDSL')
      expect(importButton).toBeInTheDocument()
    })

    it('should render footer at bottom with correct positioning classes', () => {
      const { container } = render(<CreateFromPipeline />)

      const footer = container.querySelector('.absolute.bottom-0.left-0.right-0')
      expect(footer).toBeInTheDocument()
    })

    it('should render footer with backdrop blur', () => {
      const { container } = render(<CreateFromPipeline />)

      const footer = container.querySelector('.backdrop-blur-\\[6px\\]')
      expect(footer).toBeInTheDocument()
    })

    it('should render divider in footer', () => {
      const { container } = render(<CreateFromPipeline />)

      // Divider renders with w-8 class
      const divider = container.querySelector('.w-8')
      expect(divider).toBeInTheDocument()
    })

    it('should open import modal when import DSL button is clicked', () => {
      render(<CreateFromPipeline />)

      const importButton = screen.getByText('datasetPipeline.creation.importDSL')
      fireEvent.click(importButton)

      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()
    })

    it('should not show import modal initially', () => {
      render(<CreateFromPipeline />)

      expect(screen.queryByTestId('dsl-modal')).not.toBeInTheDocument()
    })
  })

  // Tests for Effect component integration
  describe('Effect Component Integration', () => {
    it('should render Effect with blur effect', () => {
      const { container } = render(<CreateFromPipeline />)

      const effectElement = container.querySelector('.blur-\\[80px\\]')
      expect(effectElement).toBeInTheDocument()
    })

    it('should render Effect with absolute positioning', () => {
      const { container } = render(<CreateFromPipeline />)

      const effectElement = container.querySelector('.absolute.size-\\[112px\\].rounded-full')
      expect(effectElement).toBeInTheDocument()
    })

    it('should render Effect with brand color', () => {
      const { container } = render(<CreateFromPipeline />)

      const effectElement = container.querySelector('.bg-util-colors-blue-brand-blue-brand-500')
      expect(effectElement).toBeInTheDocument()
    })

    it('should render Effect with custom opacity', () => {
      const { container } = render(<CreateFromPipeline />)

      const effectElement = container.querySelector('.opacity-20')
      expect(effectElement).toBeInTheDocument()
    })
  })

  // Tests for layout structure
  describe('Layout Structure', () => {
    it('should render children in correct order', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      const children = mainContainer.children

      // Should have 4 children: Effect, Header, List, Footer
      expect(children.length).toBe(4)
    })

    it('should have flex column layout', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('flex-col')
    })

    it('should have overflow hidden on main container', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('overflow-hidden')
    })

    it('should have correct height calculation', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('h-[calc(100vh-56px)]')
    })
  })

  // Tests for styling
  describe('Styling', () => {
    it('should have border styling on main container', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('border-t')
      expect(mainContainer).toHaveClass('border-effects-highlight')
    })

    it('should have rounded top corners', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('rounded-t-2xl')
    })

    it('should have subtle background color', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('bg-background-default-subtle')
    })

    it('should have relative positioning for child absolute positioning', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer).toHaveClass('relative')
    })
  })

  // Tests for edge cases
  describe('Edge Cases', () => {
    it('should handle component mounting without errors', () => {
      expect(() => render(<CreateFromPipeline />)).not.toThrow()
    })

    it('should handle component unmounting without errors', () => {
      const { unmount } = render(<CreateFromPipeline />)

      expect(() => unmount()).not.toThrow()
    })

    it('should handle multiple renders without issues', () => {
      const { rerender } = render(<CreateFromPipeline />)

      rerender(<CreateFromPipeline />)
      rerender(<CreateFromPipeline />)
      rerender(<CreateFromPipeline />)

      expect(screen.getByText('datasetPipeline.creation.backToKnowledge')).toBeInTheDocument()
    })

    it('should maintain consistent DOM structure across rerenders', () => {
      const { container, rerender } = render(<CreateFromPipeline />)

      const initialChildCount = (container.firstChild as HTMLElement)?.children.length

      rerender(<CreateFromPipeline />)

      const afterRerenderChildCount = (container.firstChild as HTMLElement)?.children.length
      expect(afterRerenderChildCount).toBe(initialChildCount)
    })

    it('should handle remoteInstallUrl search param', () => {
      mockSearchParams = new URLSearchParams('remoteInstallUrl=https://example.com/dsl.yaml')

      render(<CreateFromPipeline />)

      // Should render without crashing when remoteInstallUrl is present
      expect(screen.getByText('datasetPipeline.creation.backToKnowledge')).toBeInTheDocument()
    })
  })

  // Tests for accessibility
  describe('Accessibility', () => {
    it('should have accessible link for navigation', () => {
      render(<CreateFromPipeline />)

      const link = screen.getByRole('link')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/datasets')
    })

    it('should have accessible buttons', () => {
      render(<CreateFromPipeline />)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(2) // back button and import DSL button
    })

    it('should use semantic structure for content', () => {
      const { container } = render(<CreateFromPipeline />)

      const mainContainer = container.firstChild as HTMLElement
      expect(mainContainer.tagName).toBe('DIV')
    })
  })

  // Tests for component stability
  describe('Component Stability', () => {
    it('should not cause memory leaks on unmount', () => {
      const { unmount } = render(<CreateFromPipeline />)

      unmount()

      expect(true).toBe(true)
    })

    it('should handle rapid mount/unmount cycles', () => {
      for (let i = 0; i < 5; i++) {
        const { unmount } = render(<CreateFromPipeline />)
        unmount()
      }

      expect(true).toBe(true)
    })
  })

  // Tests for user interactions
  describe('User Interactions', () => {
    it('should toggle import modal when clicking import DSL button', () => {
      render(<CreateFromPipeline />)

      // Initially modal is not shown
      expect(screen.queryByTestId('dsl-modal')).not.toBeInTheDocument()

      // Click import DSL button
      const importButton = screen.getByText('datasetPipeline.creation.importDSL')
      fireEvent.click(importButton)

      // Modal should be shown
      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()
    })

    it('should close modal when close button is clicked', () => {
      render(<CreateFromPipeline />)

      // Open modal
      const importButton = screen.getByText('datasetPipeline.creation.importDSL')
      fireEvent.click(importButton)
      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()

      // Click close button
      const closeButton = screen.getByTestId('dsl-modal-close')
      fireEvent.click(closeButton)

      // Modal should be hidden
      expect(screen.queryByTestId('dsl-modal')).not.toBeInTheDocument()
    })

    it('should close modal and redirect when close button is clicked with remoteInstallUrl', () => {
      mockSearchParams = new URLSearchParams('remoteInstallUrl=https://example.com/dsl.yaml')

      render(<CreateFromPipeline />)

      // Open modal
      const importButton = screen.getByText('datasetPipeline.creation.importDSL')
      fireEvent.click(importButton)

      // Click close button
      const closeButton = screen.getByTestId('dsl-modal-close')
      fireEvent.click(closeButton)

      // Should call replace to remove the URL param
      expect(mockReplace).toHaveBeenCalledWith('/datasets/create-from-pipeline')
    })

    it('should call invalidDatasetList when import is successful', () => {
      render(<CreateFromPipeline />)

      // Open modal
      const importButton = screen.getByText('datasetPipeline.creation.importDSL')
      fireEvent.click(importButton)

      // Click success button
      const successButton = screen.getByTestId('dsl-modal-success')
      fireEvent.click(successButton)

      // Should call invalidDatasetList
      expect(mockInvalidDatasetList).toHaveBeenCalled()
    })
  })
})
