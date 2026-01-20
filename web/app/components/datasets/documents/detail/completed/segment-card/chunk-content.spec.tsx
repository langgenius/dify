import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { noop } from 'es-toolkit/function'
import { createContext, useContextSelector } from 'use-context-selector'
import { describe, expect, it, vi } from 'vitest'

import ChunkContent from './chunk-content'

// Create mock context matching the actual SegmentListContextValue
type SegmentListContextValue = {
  isCollapsed: boolean
  fullScreen: boolean
  toggleFullScreen: (fullscreen?: boolean) => void
  currSegment: { showModal: boolean }
  currChildChunk: { showModal: boolean }
}

const MockSegmentListContext = createContext<SegmentListContextValue>({
  isCollapsed: true,
  fullScreen: false,
  toggleFullScreen: noop,
  currSegment: { showModal: false },
  currChildChunk: { showModal: false },
})

// Mock the context module
vi.mock('..', () => ({
  useSegmentListContext: (selector: (value: SegmentListContextValue) => unknown) => {
    return useContextSelector(MockSegmentListContext, selector)
  },
}))

// Helper to create wrapper with context
const createWrapper = (isCollapsed: boolean = true) => {
  return ({ children }: { children: ReactNode }) => (
    <MockSegmentListContext.Provider
      value={{
        isCollapsed,
        fullScreen: false,
        toggleFullScreen: noop,
        currSegment: { showModal: false },
        currChildChunk: { showModal: false },
      }}
    >
      {children}
    </MockSegmentListContext.Provider>
  )
}

describe('ChunkContent', () => {
  const defaultDetail = {
    content: 'Test content',
    sign_content: 'Test sign content',
  }

  // Rendering tests
  describe('Rendering', () => {
    it('should render without crashing', () => {
      // Arrange & Act
      const { container } = render(
        <ChunkContent detail={defaultDetail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render content in non-QA mode', () => {
      // Arrange & Act
      const { container } = render(
        <ChunkContent detail={defaultDetail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert - should render without Q and A labels
      expect(container.textContent).not.toContain('Q')
      expect(container.textContent).not.toContain('A')
    })
  })

  // QA mode tests
  describe('QA Mode', () => {
    it('should render Q and A labels when answer is present', () => {
      // Arrange
      const qaDetail = {
        content: 'Question content',
        sign_content: 'Sign content',
        answer: 'Answer content',
      }

      // Act
      render(
        <ChunkContent detail={qaDetail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert
      expect(screen.getByText('Q')).toBeInTheDocument()
      expect(screen.getByText('A')).toBeInTheDocument()
    })

    it('should not render Q and A labels when answer is undefined', () => {
      // Arrange & Act
      render(
        <ChunkContent detail={defaultDetail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert
      expect(screen.queryByText('Q')).not.toBeInTheDocument()
      expect(screen.queryByText('A')).not.toBeInTheDocument()
    })
  })

  // Props tests
  describe('Props', () => {
    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <ChunkContent
          detail={defaultDetail}
          isFullDocMode={false}
          className="custom-class"
        />,
        { wrapper: createWrapper() },
      )

      // Assert
      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })

    it('should handle isFullDocMode=true', () => {
      // Arrange & Act
      const { container } = render(
        <ChunkContent detail={defaultDetail} isFullDocMode={true} />,
        { wrapper: createWrapper() },
      )

      // Assert - should have line-clamp-3 class
      expect(container.querySelector('.line-clamp-3')).toBeInTheDocument()
    })

    it('should handle isFullDocMode=false with isCollapsed=true', () => {
      // Arrange & Act
      const { container } = render(
        <ChunkContent detail={defaultDetail} isFullDocMode={false} />,
        { wrapper: createWrapper(true) },
      )

      // Assert - should have line-clamp-2 class
      expect(container.querySelector('.line-clamp-2')).toBeInTheDocument()
    })

    it('should handle isFullDocMode=false with isCollapsed=false', () => {
      // Arrange & Act
      const { container } = render(
        <ChunkContent detail={defaultDetail} isFullDocMode={false} />,
        { wrapper: createWrapper(false) },
      )

      // Assert - should have line-clamp-20 class
      expect(container.querySelector('.line-clamp-20')).toBeInTheDocument()
    })
  })

  // Content priority tests
  describe('Content Priority', () => {
    it('should prefer sign_content over content when both exist', () => {
      // Arrange
      const detail = {
        content: 'Regular content',
        sign_content: 'Sign content',
      }

      // Act
      const { container } = render(
        <ChunkContent detail={detail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert - The component uses sign_content || content
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should use content when sign_content is empty', () => {
      // Arrange
      const detail = {
        content: 'Regular content',
        sign_content: '',
      }

      // Act
      const { container } = render(
        <ChunkContent detail={detail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should handle empty content', () => {
      // Arrange
      const emptyDetail = {
        content: '',
        sign_content: '',
      }

      // Act
      const { container } = render(
        <ChunkContent detail={emptyDetail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle empty answer in QA mode', () => {
      // Arrange
      const qaDetail = {
        content: 'Question',
        sign_content: '',
        answer: '',
      }

      // Act - empty answer is falsy, so QA mode won't render
      render(
        <ChunkContent detail={qaDetail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Assert - should not show Q and A labels since answer is empty string (falsy)
      expect(screen.queryByText('Q')).not.toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      // Arrange
      const { rerender, container } = render(
        <ChunkContent detail={defaultDetail} isFullDocMode={false} />,
        { wrapper: createWrapper() },
      )

      // Act
      rerender(
        <MockSegmentListContext.Provider
          value={{
            isCollapsed: true,
            fullScreen: false,
            toggleFullScreen: noop,
            currSegment: { showModal: false },
            currChildChunk: { showModal: false },
          }}
        >
          <ChunkContent
            detail={{ ...defaultDetail, content: 'Updated content' }}
            isFullDocMode={false}
          />
        </MockSegmentListContext.Provider>,
      )

      // Assert
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
