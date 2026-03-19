import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '../index'
import styles from '../index.module.css'

const renderScrollArea = (options: {
  rootClassName?: string
  viewportClassName?: string
  verticalScrollbarClassName?: string
  horizontalScrollbarClassName?: string
  verticalThumbClassName?: string
  horizontalThumbClassName?: string
} = {}) => {
  return render(
    <ScrollAreaRoot className={options.rootClassName ?? 'h-40 w-40'} data-testid="scroll-area-root">
      <ScrollAreaViewport data-testid="scroll-area-viewport" className={options.viewportClassName}>
        <ScrollAreaContent data-testid="scroll-area-content">
          <div className="h-48 w-48">Scrollable content</div>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar
        keepMounted
        data-testid="scroll-area-vertical-scrollbar"
        className={options.verticalScrollbarClassName}
      >
        <ScrollAreaThumb data-testid="scroll-area-vertical-thumb" className={options.verticalThumbClassName} />
      </ScrollAreaScrollbar>
      <ScrollAreaScrollbar
        keepMounted
        orientation="horizontal"
        data-testid="scroll-area-horizontal-scrollbar"
        className={options.horizontalScrollbarClassName}
      >
        <ScrollAreaThumb
          data-testid="scroll-area-horizontal-thumb"
          className={options.horizontalThumbClassName}
        />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>,
  )
}

describe('scroll-area wrapper', () => {
  describe('Rendering', () => {
    it('should render the compound exports together', async () => {
      renderScrollArea()

      await waitFor(() => {
        expect(screen.getByTestId('scroll-area-root')).toBeInTheDocument()
        expect(screen.getByTestId('scroll-area-viewport')).toBeInTheDocument()
        expect(screen.getByTestId('scroll-area-content')).toHaveTextContent('Scrollable content')
        expect(screen.getByTestId('scroll-area-vertical-scrollbar')).toBeInTheDocument()
        expect(screen.getByTestId('scroll-area-vertical-thumb')).toBeInTheDocument()
        expect(screen.getByTestId('scroll-area-horizontal-scrollbar')).toBeInTheDocument()
        expect(screen.getByTestId('scroll-area-horizontal-thumb')).toBeInTheDocument()
      })
    })

    it('should render the convenience wrapper and apply slot props', async () => {
      render(
        <>
          <p id="installed-apps-label">Installed apps</p>
          <ScrollArea
            className="h-40 w-40"
            slotClassNames={{
              content: 'custom-content-class',
              scrollbar: 'custom-scrollbar-class',
              viewport: 'custom-viewport-class',
            }}
            labelledBy="installed-apps-label"
            data-testid="scroll-area-wrapper-root"
          >
            <div className="h-48 w-20">Scrollable content</div>
          </ScrollArea>
        </>,
      )

      await waitFor(() => {
        const root = screen.getByTestId('scroll-area-wrapper-root')
        const viewport = screen.getByRole('region', { name: 'Installed apps' })
        const content = screen.getByText('Scrollable content').parentElement

        expect(root).toBeInTheDocument()
        expect(viewport).toHaveClass('custom-viewport-class')
        expect(viewport).toHaveAccessibleName('Installed apps')
        expect(content).toHaveClass('custom-content-class')
        expect(screen.getByText('Scrollable content')).toBeInTheDocument()
      })
    })
  })

  describe('Scrollbar', () => {
    it('should apply the default vertical scrollbar classes and orientation data attribute', async () => {
      renderScrollArea()

      await waitFor(() => {
        const scrollbar = screen.getByTestId('scroll-area-vertical-scrollbar')
        const thumb = screen.getByTestId('scroll-area-vertical-thumb')

        expect(scrollbar).toHaveAttribute('data-orientation', 'vertical')
        expect(scrollbar).toHaveClass(styles.scrollbar)
        expect(scrollbar).toHaveClass(
          'flex',
          'overflow-clip',
          'p-1',
          'touch-none',
          'select-none',
          'opacity-100',
          'transition-opacity',
          'motion-reduce:transition-none',
          'pointer-events-none',
          'data-[hovering]:pointer-events-auto',
          'data-[scrolling]:pointer-events-auto',
          'data-[orientation=vertical]:absolute',
          'data-[orientation=vertical]:inset-y-0',
          'data-[orientation=vertical]:w-3',
          'data-[orientation=vertical]:justify-center',
        )
        expect(thumb).toHaveAttribute('data-orientation', 'vertical')
        expect(thumb).toHaveClass(
          'shrink-0',
          'rounded-[4px]',
          'bg-state-base-handle',
          'transition-[background-color]',
          'motion-reduce:transition-none',
          'data-[orientation=vertical]:w-1',
        )
      })
    })

    it('should apply horizontal scrollbar and thumb classes when orientation is horizontal', async () => {
      renderScrollArea()

      await waitFor(() => {
        const scrollbar = screen.getByTestId('scroll-area-horizontal-scrollbar')
        const thumb = screen.getByTestId('scroll-area-horizontal-thumb')

        expect(scrollbar).toHaveAttribute('data-orientation', 'horizontal')
        expect(scrollbar).toHaveClass(styles.scrollbar)
        expect(scrollbar).toHaveClass(
          'flex',
          'overflow-clip',
          'p-1',
          'touch-none',
          'select-none',
          'opacity-100',
          'transition-opacity',
          'motion-reduce:transition-none',
          'pointer-events-none',
          'data-[hovering]:pointer-events-auto',
          'data-[scrolling]:pointer-events-auto',
          'data-[orientation=horizontal]:absolute',
          'data-[orientation=horizontal]:inset-x-0',
          'data-[orientation=horizontal]:h-3',
          'data-[orientation=horizontal]:items-center',
        )
        expect(thumb).toHaveAttribute('data-orientation', 'horizontal')
        expect(thumb).toHaveClass(
          'shrink-0',
          'rounded-[4px]',
          'bg-state-base-handle',
          'transition-[background-color]',
          'motion-reduce:transition-none',
          'data-[orientation=horizontal]:h-1',
        )
      })
    })
  })

  describe('Props', () => {
    it('should forward className to the viewport', async () => {
      renderScrollArea({
        viewportClassName: 'custom-viewport-class',
      })

      await waitFor(() => {
        expect(screen.getByTestId('scroll-area-viewport')).toHaveClass(
          'size-full',
          'min-h-0',
          'min-w-0',
          'outline-none',
          'focus-visible:ring-1',
          'focus-visible:ring-inset',
          'focus-visible:ring-components-input-border-hover',
          'custom-viewport-class',
        )
      })
    })

    it('should let callers control scrollbar inset spacing via margin-based className overrides', async () => {
      renderScrollArea({
        verticalScrollbarClassName: 'data-[orientation=vertical]:my-2 data-[orientation=vertical]:[margin-inline-end:-0.75rem]',
        horizontalScrollbarClassName: 'data-[orientation=horizontal]:mx-2 data-[orientation=horizontal]:mb-2',
      })

      await waitFor(() => {
        expect(screen.getByTestId('scroll-area-vertical-scrollbar')).toHaveClass(
          'data-[orientation=vertical]:my-2',
          'data-[orientation=vertical]:[margin-inline-end:-0.75rem]',
        )
        expect(screen.getByTestId('scroll-area-horizontal-scrollbar')).toHaveClass(
          'data-[orientation=horizontal]:mx-2',
          'data-[orientation=horizontal]:mb-2',
        )
      })
    })
  })

  describe('Corner', () => {
    it('should render the corner export when both axes overflow', async () => {
      const originalDescriptors = {
        clientHeight: Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, 'clientHeight'),
        clientWidth: Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, 'clientWidth'),
        scrollHeight: Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, 'scrollHeight'),
        scrollWidth: Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, 'scrollWidth'),
      }

      Object.defineProperties(HTMLDivElement.prototype, {
        clientHeight: {
          configurable: true,
          get() {
            return this.getAttribute('data-testid') === 'scroll-area-viewport' ? 80 : 0
          },
        },
        clientWidth: {
          configurable: true,
          get() {
            return this.getAttribute('data-testid') === 'scroll-area-viewport' ? 80 : 0
          },
        },
        scrollHeight: {
          configurable: true,
          get() {
            return this.getAttribute('data-testid') === 'scroll-area-viewport' ? 160 : 0
          },
        },
        scrollWidth: {
          configurable: true,
          get() {
            return this.getAttribute('data-testid') === 'scroll-area-viewport' ? 160 : 0
          },
        },
      })

      try {
        render(
          <ScrollAreaRoot className="h-40 w-40" data-testid="scroll-area-root">
            <ScrollAreaViewport data-testid="scroll-area-viewport">
              <ScrollAreaContent data-testid="scroll-area-content">
                <div className="h-48 w-48">Scrollable content</div>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar keepMounted data-testid="scroll-area-vertical-scrollbar">
              <ScrollAreaThumb data-testid="scroll-area-vertical-thumb" />
            </ScrollAreaScrollbar>
            <ScrollAreaScrollbar
              keepMounted
              orientation="horizontal"
              data-testid="scroll-area-horizontal-scrollbar"
            >
              <ScrollAreaThumb data-testid="scroll-area-horizontal-thumb" />
            </ScrollAreaScrollbar>
            <ScrollAreaCorner data-testid="scroll-area-corner" />
          </ScrollAreaRoot>,
        )

        await waitFor(() => {
          expect(screen.getByTestId('scroll-area-corner')).toBeInTheDocument()
          expect(screen.getByTestId('scroll-area-corner')).toHaveClass('bg-transparent')
        })
      }
      finally {
        if (originalDescriptors.clientHeight) {
          Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', originalDescriptors.clientHeight)
        }
        if (originalDescriptors.clientWidth) {
          Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', originalDescriptors.clientWidth)
        }
        if (originalDescriptors.scrollHeight) {
          Object.defineProperty(HTMLDivElement.prototype, 'scrollHeight', originalDescriptors.scrollHeight)
        }
        if (originalDescriptors.scrollWidth) {
          Object.defineProperty(HTMLDivElement.prototype, 'scrollWidth', originalDescriptors.scrollWidth)
        }
      }
    })
  })
})
