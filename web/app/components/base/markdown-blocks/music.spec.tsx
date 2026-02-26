import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from '@/app/components/base/markdown/error-boundary'
import MarkdownMusic from './music'

describe('MarkdownMusic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Base rendering behavior for the component shell.
  describe('Rendering', () => {
    it('should render wrapper and two internal container nodes', () => {
      const { container } = render(<MarkdownMusic><span>child</span></MarkdownMusic>)

      const topLevel = container.firstElementChild as HTMLElement | null
      expect(topLevel).toBeTruthy()
      expect(topLevel?.children.length).toBe(2)
      expect(topLevel?.style.minWidth).toBe('100%')
      expect(topLevel?.style.overflow).toBe('auto')
    })
  })

  // String input triggers abcjs execution in jsdom; verify error is safely catchable.
  describe('String Input', () => {
    it('should render fallback when abcjs audio initialization fails in test environment', async () => {
      render(
        <ErrorBoundary>
          <MarkdownMusic>{'X:1\nT:Test\nK:C\nC D E F|'}</MarkdownMusic>
        </ErrorBoundary>,
      )

      expect(await screen.findByText(/Oops! An error occurred./i)).toBeInTheDocument()
    })

    it('should not render fallback when children is not a string', () => {
      render(
        <ErrorBoundary>
          <MarkdownMusic><span>not a string</span></MarkdownMusic>
        </ErrorBoundary>,
      )

      expect(screen.queryByText(/Oops! An error occurred./i)).not.toBeInTheDocument()
    })
  })
})
