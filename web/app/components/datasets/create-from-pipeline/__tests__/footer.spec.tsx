import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import Footer from '../footer'

const invalidateQueries = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
const datasetListKey = consoleQuery.datasets.get.key()

// Configurable mock for search params
let mockSearchParams = new URLSearchParams()
const mockReplace = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}))

// Mock CreateFromDSLModal to capture props
let capturedActiveTab: string | undefined
let capturedDslUrl: string | undefined

vi.mock('../create-options/create-from-dsl-modal', () => ({
  default: ({
    show,
    onClose,
    onSuccess,
    activeTab,
    dslUrl,
  }: {
    show: boolean
    onClose: () => void
    onSuccess: () => void
    activeTab?: string
    dslUrl?: string
  }) => {
    capturedActiveTab = activeTab
    capturedDslUrl = dslUrl
    return show ? (
      <div data-testid="dsl-modal">
        <button data-testid="close-modal" onClick={onClose}>
          Close
        </button>
        <button data-testid="success-modal" onClick={onSuccess}>
          Success
        </button>
      </div>
    ) : null
  },
  CreateFromDSLModalTab: {
    FROM_URL: 'FROM_URL',
    FROM_FILE: 'FROM_FILE',
  },
}))

// Footer Component Tests

describe('Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
    capturedActiveTab = undefined
    capturedDslUrl = undefined
  })

  describe('Rendering', () => {
    it('should render import button with icon', () => {
      const { container } = renderWithConsoleQuery(<Footer />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should not show modal initially', () => {
      renderWithConsoleQuery(<Footer />)
      expect(screen.queryByTestId('dsl-modal')).not.toBeInTheDocument()
    })

    it('should render divider', () => {
      const { container } = renderWithConsoleQuery(<Footer />)
      const divider = container.querySelector('[class*="w-8"]')
      expect(divider).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open modal when import button is clicked', () => {
      renderWithConsoleQuery(<Footer />)

      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()
    })

    it('should close modal when onClose is called', () => {
      renderWithConsoleQuery(<Footer />)

      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)
      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()

      const closeButton = screen.getByTestId('close-modal')
      fireEvent.click(closeButton)
      expect(screen.queryByTestId('dsl-modal')).not.toBeInTheDocument()
    })

    it('should call invalidDatasetList on success', () => {
      renderWithConsoleQuery(<Footer />)

      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      // Trigger success
      const successButton = screen.getByTestId('success-modal')
      fireEvent.click(successButton)

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: datasetListKey })
    })
  })

  describe('Layout', () => {
    it('should have backdrop blur-sm effect', () => {
      const { container } = renderWithConsoleQuery(<Footer />)
      const footerDiv = container.firstChild as HTMLElement
      expect(footerDiv).toHaveClass('backdrop-blur-[6px]')
    })
  })

  // URL Parameter Tests (Branch Coverage)
  describe('URL Parameter Handling', () => {
    it('should set activeTab to FROM_URL when dslUrl is present', () => {
      mockSearchParams = new URLSearchParams('remoteInstallUrl=https://example.com/dsl')

      renderWithConsoleQuery(<Footer />)

      // Open modal to trigger prop capture
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      expect(capturedActiveTab).toBe('FROM_URL')
      expect(capturedDslUrl).toBe('https://example.com/dsl')
    })

    it('should set activeTab to undefined when dslUrl is not present', () => {
      mockSearchParams = new URLSearchParams()

      renderWithConsoleQuery(<Footer />)

      // Open modal to trigger prop capture
      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      expect(capturedActiveTab).toBeUndefined()
      expect(capturedDslUrl).toBeUndefined()
    })

    it('should call replace when closing modal with dslUrl present', () => {
      mockSearchParams = new URLSearchParams('remoteInstallUrl=https://example.com/dsl')

      renderWithConsoleQuery(<Footer />)

      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)
      expect(screen.getByTestId('dsl-modal')).toBeInTheDocument()

      const closeButton = screen.getByTestId('close-modal')
      fireEvent.click(closeButton)

      expect(mockReplace).toHaveBeenCalledWith('/datasets/create-from-pipeline')
    })

    it('should not call replace when closing modal without dslUrl', () => {
      mockSearchParams = new URLSearchParams()

      renderWithConsoleQuery(<Footer />)

      const importButton = screen.getByText(/importDSL/i)
      fireEvent.click(importButton)

      const closeButton = screen.getByTestId('close-modal')
      fireEvent.click(closeButton)

      expect(mockReplace).not.toHaveBeenCalled()
    })
  })
})
