import * as React from 'react'
import { render } from 'vitest-browser-react'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '../index'

const stubElementMetric = (
  element: HTMLElement,
  property: 'clientHeight' | 'clientWidth' | 'scrollHeight' | 'scrollWidth',
  value: number,
) => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(element, property)

  Object.defineProperty(element, property, {
    configurable: true,
    get: () => value,
  })

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(element, property, originalDescriptor)
      return
    }

    delete (element as Partial<Record<typeof property, number>>)[property]
  }
}

const renderScrollArea = (
  options: {
    rootClassName?: string
    contentStyle?: React.CSSProperties
    viewportClassName?: string
    viewportStyle?: React.CSSProperties
    verticalScrollbarClassName?: string
    horizontalScrollbarClassName?: string
    verticalThumbClassName?: string
    horizontalThumbClassName?: string
  } = {},
) => {
  return render(
    <ScrollArea className={options.rootClassName ?? 'h-40 w-40'} data-testid="scroll-area-root">
      <ScrollAreaViewport
        data-testid="scroll-area-viewport"
        style={options.viewportStyle}
        className={options.viewportClassName}
      >
        <ScrollAreaContent data-testid="scroll-area-content" style={options.contentStyle}>
          <div className="h-48 w-48">Scrollable content</div>
        </ScrollAreaContent>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar
        keepMounted
        data-testid="scroll-area-vertical-scrollbar"
        className={options.verticalScrollbarClassName}
      >
        <ScrollAreaThumb
          data-testid="scroll-area-vertical-thumb"
          className={options.verticalThumbClassName}
        />
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
    </ScrollArea>,
  )
}

describe('scroll area', () => {
  describe('Rendering', () => {
    it('should render the compound exports together', async () => {
      const screen = await renderScrollArea()

      await expect.element(screen.getByTestId('scroll-area-root')).toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-viewport')).toBeInTheDocument()
      await expect
        .element(screen.getByTestId('scroll-area-content'))
        .toHaveTextContent('Scrollable content')
      await expect.element(screen.getByTestId('scroll-area-vertical-scrollbar')).toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-vertical-thumb')).toBeInTheDocument()
      await expect
        .element(screen.getByTestId('scroll-area-horizontal-scrollbar'))
        .toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-horizontal-thumb')).toBeInTheDocument()
    })

    it('should keep accessible region semantics on the viewport', async () => {
      const screen = await render(
        <>
          <p id="installed-apps-label">Installed apps</p>
          <ScrollArea className="h-40 w-40" data-testid="scroll-area-root">
            <ScrollAreaViewport
              aria-labelledby="installed-apps-label"
              className="custom-viewport-class"
              role="region"
            >
              <ScrollAreaContent className="custom-content-class">
                <div className="h-48 w-20">Scrollable content</div>
              </ScrollAreaContent>
            </ScrollAreaViewport>
            <ScrollAreaScrollbar className="custom-scrollbar-class">
              <ScrollAreaThumb />
            </ScrollAreaScrollbar>
          </ScrollArea>
        </>,
      )

      const viewport = screen.getByRole('region', { name: 'Installed apps' })
      const content = screen.getByText('Scrollable content').element().parentElement

      await expect
        .element(screen.getByTestId('scroll-area-root'))
        .not.toHaveAttribute('role', 'region')
      await expect.element(viewport).toHaveClass('custom-viewport-class')
      await expect.element(viewport).toHaveAccessibleName('Installed apps')
      expect(content).toHaveClass('custom-content-class')
      await expect.element(screen.getByText('Scrollable content')).toBeInTheDocument()
    })

    it('should keep scrolling, focus, events, and refs on the viewport', async () => {
      let rootElement: HTMLDivElement | null = null
      let viewportElement: HTMLDivElement | null = null
      let scrollOwner: HTMLDivElement | null = null
      const onScroll = vi.fn((event: React.UIEvent<HTMLDivElement>) => {
        scrollOwner = event.currentTarget
      })

      await render(
        <ScrollArea
          ref={(node) => {
            rootElement = node
          }}
          style={{ height: 100, width: 100 }}
        >
          <ScrollAreaViewport
            ref={(node) => {
              viewportElement = node
            }}
            aria-label="Scrollable results"
            onScroll={onScroll}
            role="region"
            style={{ height: '100%', width: '100%' }}
          >
            <ScrollAreaContent style={{ minWidth: 0 }}>
              <div style={{ height: 200, width: 100 }}>Scrollable content</div>
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>,
      )

      await vi.waitFor(() => {
        expect(viewportElement).not.toBeNull()
        expect(viewportElement!.scrollHeight).toBeGreaterThan(viewportElement!.clientHeight)
        expect(viewportElement).toHaveAttribute('tabindex', '0')
      })

      viewportElement!.focus()
      expect(document.activeElement).toBe(viewportElement)

      viewportElement!.scrollTop = 40
      await vi.waitFor(() => expect(onScroll).toHaveBeenCalled())

      expect(viewportElement!.scrollTop).toBe(40)
      expect(scrollOwner).toBe(viewportElement)
      expect(rootElement).not.toBe(viewportElement)
      expect(rootElement).not.toHaveAttribute('tabindex')
    })
  })

  describe('Scrollbar', () => {
    it('should apply the vertical orientation data attribute', async () => {
      const screen = await renderScrollArea()

      await expect
        .element(screen.getByTestId('scroll-area-vertical-scrollbar'))
        .toHaveAttribute('data-orientation', 'vertical')
      await expect
        .element(screen.getByTestId('scroll-area-vertical-scrollbar'))
        .toHaveAttribute('data-dify-scrollbar')
      await expect
        .element(screen.getByTestId('scroll-area-vertical-thumb'))
        .toHaveAttribute('data-orientation', 'vertical')
    })

    it('should apply horizontal orientation data attributes', async () => {
      const screen = await renderScrollArea()

      await expect
        .element(screen.getByTestId('scroll-area-horizontal-scrollbar'))
        .toHaveAttribute('data-orientation', 'horizontal')
      await expect
        .element(screen.getByTestId('scroll-area-horizontal-scrollbar'))
        .toHaveAttribute('data-dify-scrollbar')
      await expect
        .element(screen.getByTestId('scroll-area-horizontal-thumb'))
        .toHaveAttribute('data-orientation', 'horizontal')
    })
  })

  describe('Props', () => {
    it('should forward className to the viewport', async () => {
      const screen = await renderScrollArea({
        viewportClassName: 'custom-viewport-class',
      })

      await expect
        .element(screen.getByTestId('scroll-area-viewport'))
        .toHaveClass('custom-viewport-class')
    })

    it('should let callers control scrollbar inset spacing via margin-based className overrides', async () => {
      const screen = await renderScrollArea({
        verticalScrollbarClassName:
          'data-[orientation=vertical]:my-2 data-[orientation=vertical]:-me-3',
        horizontalScrollbarClassName:
          'data-[orientation=horizontal]:mx-2 data-[orientation=horizontal]:mb-2',
      })

      await expect
        .element(screen.getByTestId('scroll-area-vertical-scrollbar'))
        .toHaveClass('data-[orientation=vertical]:my-2', 'data-[orientation=vertical]:-me-3')
      await expect
        .element(screen.getByTestId('scroll-area-horizontal-scrollbar'))
        .toHaveClass('data-[orientation=horizontal]:mx-2', 'data-[orientation=horizontal]:mb-2')
    })

    it('should let vertical layouts override the content minimum width without important CSS', async () => {
      const screen = await renderScrollArea({ contentStyle: { minWidth: 0 } })
      const content = screen.getByTestId('scroll-area-content').element()

      expect(getComputedStyle(content).minWidth).toBe('0px')
      expect(content.style.getPropertyPriority('min-width')).toBe('')
    })

    it('should let callers constrain a viewport axis without important CSS', async () => {
      const screen = await renderScrollArea({ viewportStyle: { overflowX: 'hidden' } })
      const viewport = screen.getByTestId('scroll-area-viewport').element()

      expect(getComputedStyle(viewport).overflowX).toBe('hidden')
      expect(viewport.style.getPropertyPriority('overflow-x')).toBe('')
    })
  })

  describe('Corner', () => {
    it('should render the corner export when both axes overflow', async () => {
      const restoreViewportMetrics: Array<() => void> = []

      try {
        const screen = await render(
          <ScrollArea className="h-40 w-40" data-testid="scroll-area-root">
            <ScrollAreaViewport
              data-testid="scroll-area-viewport"
              ref={(node) => {
                if (!node || restoreViewportMetrics.length > 0) return

                restoreViewportMetrics.push(
                  stubElementMetric(node, 'clientHeight', 80),
                  stubElementMetric(node, 'clientWidth', 80),
                  stubElementMetric(node, 'scrollHeight', 160),
                  stubElementMetric(node, 'scrollWidth', 160),
                )
              }}
            >
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
          </ScrollArea>,
        )

        await vi.waitFor(() => {
          expect(screen.getByTestId('scroll-area-corner').element()).toBeInTheDocument()
        })
      } finally {
        restoreViewportMetrics.splice(0).forEach((restore) => restore())
      }
    })
  })
})
