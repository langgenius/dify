import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PublishToast from './publish-toast'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

// Mock workflow store with controllable state
let mockPublishedAt = 0
vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    return selector({ publishedAt: mockPublishedAt })
  },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PublishToast', () => {
  beforeEach(() => {
    mockPublishedAt = 0
  })

  describe('rendering', () => {
    it('should render when publishedAt is 0', () => {
      mockPublishedAt = 0
      render(<PublishToast />)

      expect(screen.getByText('publishToast.title')).toBeInTheDocument()
    })

    it('should render toast title', () => {
      render(<PublishToast />)

      expect(screen.getByText('publishToast.title')).toBeInTheDocument()
    })

    it('should render toast description', () => {
      render(<PublishToast />)

      expect(screen.getByText('publishToast.desc')).toBeInTheDocument()
    })

    it('should not render when publishedAt is set', () => {
      mockPublishedAt = Date.now()
      const { container } = render(<PublishToast />)

      expect(container.firstChild).toBeNull()
    })

    it('should have correct positioning classes', () => {
      render(<PublishToast />)

      const container = screen.getByText('publishToast.title').closest('.absolute')
      expect(container).toHaveClass('bottom-[45px]', 'left-0', 'right-0', 'z-10')
    })

    it('should render info icon', () => {
      const { container } = render(<PublishToast />)

      // The RiInformation2Fill icon should be rendered
      const iconContainer = container.querySelector('.text-text-accent')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render close button', () => {
      const { container } = render(<PublishToast />)

      // The close button is a div with cursor-pointer, not a semantic button
      const closeButton = container.querySelector('.cursor-pointer')
      expect(closeButton).toBeInTheDocument()
    })
  })

  describe('user interactions', () => {
    it('should hide toast when close button is clicked', () => {
      const { container } = render(<PublishToast />)

      // The close button is a div with cursor-pointer, not a semantic button
      const closeButton = container.querySelector('.cursor-pointer')
      expect(screen.getByText('publishToast.title')).toBeInTheDocument()

      fireEvent.click(closeButton!)

      expect(screen.queryByText('publishToast.title')).not.toBeInTheDocument()
    })

    it('should remain hidden after close button is clicked', () => {
      const { container, rerender } = render(<PublishToast />)

      // The close button is a div with cursor-pointer, not a semantic button
      const closeButton = container.querySelector('.cursor-pointer')
      fireEvent.click(closeButton!)

      rerender(<PublishToast />)

      expect(screen.queryByText('publishToast.title')).not.toBeInTheDocument()
    })
  })

  describe('styling', () => {
    it('should have gradient overlay', () => {
      const { container } = render(<PublishToast />)

      const gradientOverlay = container.querySelector('.bg-gradient-to-r')
      expect(gradientOverlay).toBeInTheDocument()
    })

    it('should have correct toast width', () => {
      render(<PublishToast />)

      const toastContainer = screen.getByText('publishToast.title').closest('.w-\\[420px\\]')
      expect(toastContainer).toBeInTheDocument()
    })

    it('should have rounded border', () => {
      render(<PublishToast />)

      const toastContainer = screen.getByText('publishToast.title').closest('.rounded-xl')
      expect(toastContainer).toBeInTheDocument()
    })
  })
})
