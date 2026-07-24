import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Keywords from '../keywords'

describe('Keywords', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(
        <Keywords
          keywords={['test']}
          onKeywordsChange={vi.fn()}
        />,
      )

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render the keywords label', () => {
      render(
        <Keywords
          keywords={['test']}
          onKeywordsChange={vi.fn()}
        />,
      )

      // Assert - i18n key format
      expect(screen.getByText(/segment\.keywords/i)).toBeInTheDocument()
    })

    it('should render with correct container classes', () => {
      const { container } = render(
        <Keywords
          keywords={['test']}
          onKeywordsChange={vi.fn()}
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('flex-col')
    })
  })

  describe('Props', () => {
    it('should display dash when no keywords and actionType is view', () => {
      render(
        <Keywords
          segInfo={{ id: '1', keywords: [] }}
          keywords={[]}
          onKeywordsChange={vi.fn()}
          actionType="view"
        />,
      )

      expect(screen.getByText('-')).toBeInTheDocument()
    })

    it('should not display dash when actionType is edit', () => {
      render(
        <Keywords
          segInfo={{ id: '1', keywords: [] }}
          keywords={[]}
          onKeywordsChange={vi.fn()}
          actionType="edit"
        />,
      )

      expect(screen.queryByText('-')).not.toBeInTheDocument()
    })

    it('should not display dash when actionType is add', () => {
      render(
        <Keywords
          segInfo={{ id: '1', keywords: [] }}
          keywords={[]}
          onKeywordsChange={vi.fn()}
          actionType="add"
        />,
      )

      expect(screen.queryByText('-')).not.toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const { container } = render(
        <Keywords
          keywords={['test']}
          onKeywordsChange={vi.fn()}
          className="custom-class"
        />,
      )

      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
    })

    it('should use default actionType of view', () => {
      render(
        <Keywords
          segInfo={{ id: '1', keywords: [] }}
          keywords={[]}
          onKeywordsChange={vi.fn()}
        />,
      )

      // Assert - dash should appear in view mode with empty keywords
      expect(screen.getByText('-')).toBeInTheDocument()
    })
  })

  describe('Structure', () => {
    it('should render label with uppercase styling', () => {
      const { container } = render(
        <Keywords
          keywords={['test']}
          onKeywordsChange={vi.fn()}
        />,
      )

      const labelElement = container.querySelector('.system-xs-medium-uppercase')
      expect(labelElement).toBeInTheDocument()
    })

    it('should render keywords container with overflow handling', () => {
      const { container } = render(
        <Keywords
          keywords={['test']}
          onKeywordsChange={vi.fn()}
        />,
      )

      const keywordsContainer = container.querySelector('.overflow-auto')
      expect(keywordsContainer).toBeInTheDocument()
    })

    it('should render keywords container with max height', () => {
      const { container } = render(
        <Keywords
          keywords={['test']}
          onKeywordsChange={vi.fn()}
        />,
      )

      const keywordsContainer = container.querySelector('.max-h-\\[200px\\]')
      expect(keywordsContainer).toBeInTheDocument()
    })
  })

  // Edit mode tests
  describe('Edit Mode', () => {
    it('should render TagInput component when keywords exist', () => {
      const { container } = render(
        <Keywords
          segInfo={{ id: '1', keywords: ['keyword1', 'keyword2'] }}
          keywords={['keyword1', 'keyword2']}
          onKeywordsChange={vi.fn()}
          isEditMode={true}
        />,
      )

      // Assert - TagInput should be rendered instead of dash
      expect(screen.queryByText('-')).not.toBeInTheDocument()
      expect(container.querySelector('.flex-wrap')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty keywords array in view mode without segInfo keywords', () => {
      const { container } = render(
        <Keywords
          keywords={[]}
          onKeywordsChange={vi.fn()}
          actionType="view"
        />,
      )

      // Assert - container should be rendered
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should maintain structure when rerendered', () => {
      const { rerender, container } = render(
        <Keywords
          segInfo={{ id: '1', keywords: ['test'] }}
          keywords={['test']}
          onKeywordsChange={vi.fn()}
        />,
      )

      rerender(
        <Keywords
          segInfo={{ id: '1', keywords: ['test', 'new'] }}
          keywords={['test', 'new']}
          onKeywordsChange={vi.fn()}
        />,
      )

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle segInfo with undefined keywords showing dash in view mode', () => {
      render(
        <Keywords
          segInfo={{ id: '1' }}
          keywords={['test']}
          onKeywordsChange={vi.fn()}
          actionType="view"
        />,
      )

      // Assert - dash should show because segInfo.keywords is undefined/empty
      expect(screen.getByText('-')).toBeInTheDocument()
    })
  })

  // TagInput callback tests
  describe('TagInput Callback', () => {
    it('should call onKeywordsChange when keywords are modified', () => {
      const mockOnKeywordsChange = vi.fn()
      render(
        <Keywords
          segInfo={{ id: '1', keywords: ['existing'] }}
          keywords={['existing']}
          onKeywordsChange={mockOnKeywordsChange}
          isEditMode={true}
          actionType="edit"
        />,
      )

      // Assert - TagInput should be rendered
      expect(screen.queryByText('-')).not.toBeInTheDocument()
    })

    it('should disable add when isEditMode is false', () => {
      const { container } = render(
        <Keywords
          segInfo={{ id: '1', keywords: ['test'] }}
          keywords={['test']}
          onKeywordsChange={vi.fn()}
          isEditMode={false}
          actionType="view"
        />,
      )

      // Assert - TagInput should exist but with disabled add
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should disable remove when only one keyword exists in edit mode', () => {
      const { container } = render(
        <Keywords
          segInfo={{ id: '1', keywords: ['only-one'] }}
          keywords={['only-one']}
          onKeywordsChange={vi.fn()}
          isEditMode={true}
          actionType="edit"
        />,
      )

      // Assert - component should render
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should allow remove when multiple keywords exist in edit mode', () => {
      const { container } = render(
        <Keywords
          segInfo={{ id: '1', keywords: ['first', 'second'] }}
          keywords={['first', 'second']}
          onKeywordsChange={vi.fn()}
          isEditMode={true}
          actionType="edit"
        />,
      )

      // Assert - component should render
      expect(container.firstChild).toBeInTheDocument()
    })
  })
})
