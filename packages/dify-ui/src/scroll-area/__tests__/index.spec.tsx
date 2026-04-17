import { render } from 'vitest-browser-react'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaCorner,
  ScrollAreaRoot,
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
      const screen = await renderScrollArea()

      await expect.element(screen.getByTestId('scroll-area-root')).toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-viewport')).toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-content')).toHaveTextContent('Scrollable content')
      await expect.element(screen.getByTestId('scroll-area-vertical-scrollbar')).toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-vertical-thumb')).toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-horizontal-scrollbar')).toBeInTheDocument()
      await expect.element(screen.getByTestId('scroll-area-horizontal-thumb')).toBeInTheDocument()
    })

    it('should render the convenience wrapper and apply slot props', async () => {
      const screen = await render(
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

      const viewport = screen.getByRole('region', { name: 'Installed apps' })
      const content = screen.getByText('Scrollable content').element().parentElement

      await expect.element(screen.getByTestId('scroll-area-wrapper-root')).toBeInTheDocument()
      await expect.element(viewport).toHaveClass('custom-viewport-class')
      await expect.element(viewport).toHaveAccessibleName('Installed apps')
      expect(content).toHaveClass('custom-content-class')
      await expect.element(screen.getByText('Scrollable content')).toBeInTheDocument()
    })
  })

  describe('Scrollbar', () => {
    it('should apply the default vertical scrollbar classes and orientation data attribute', async () => {
      const screen = await renderScrollArea()

      await expect.element(screen.getByTestId('scroll-area-vertical-scrollbar')).toHaveAttribute('data-orientation', 'vertical')
      await expect.element(screen.getByTestId('scroll-area-vertical-scrollbar')).toHaveAttribute('data-dify-scrollbar')
      await expect.element(screen.getByTestId('scroll-area-vertical-scrollbar')).toHaveClass(
        'flex',
        'overflow-clip',
        'p-1',
        'touch-none',
        'select-none',
        'opacity-100',
        'transition-opacity',
        'motion-reduce:transition-none',
        'pointer-events-none',
        'data-hovering:pointer-events-auto',
        'data-scrolling:pointer-events-auto',
        'data-[orientation=vertical]:absolute',
        'data-[orientation=vertical]:inset-y-0',
        'data-[orientation=vertical]:w-3',
        'data-[orientation=vertical]:justify-center',
      )
      await expect.element(screen.getByTestId('scroll-area-vertical-thumb')).toHaveAttribute('data-orientation', 'vertical')
      await expect.element(screen.getByTestId('scroll-area-vertical-thumb')).toHaveClass(
        'shrink-0',
        'rounded-sm',
        'bg-state-base-handle',
        'transition-[background-color]',
        'motion-reduce:transition-none',
        'data-[orientation=vertical]:w-1',
      )
    })

    it('should apply horizontal scrollbar and thumb classes when orientation is horizontal', async () => {
      const screen = await renderScrollArea()

      await expect.element(screen.getByTestId('scroll-area-horizontal-scrollbar')).toHaveAttribute('data-orientation', 'horizontal')
      await expect.element(screen.getByTestId('scroll-area-horizontal-scrollbar')).toHaveAttribute('data-dify-scrollbar')
      await expect.element(screen.getByTestId('scroll-area-horizontal-scrollbar')).toHaveClass(
        'flex',
        'overflow-clip',
        'p-1',
        'touch-none',
        'select-none',
        'opacity-100',
        'transition-opacity',
        'motion-reduce:transition-none',
        'pointer-events-none',
        'data-hovering:pointer-events-auto',
        'data-scrolling:pointer-events-auto',
        'data-[orientation=horizontal]:absolute',
        'data-[orientation=horizontal]:inset-x-0',
        'data-[orientation=horizontal]:h-3',
        'data-[orientation=horizontal]:items-center',
      )
      await expect.element(screen.getByTestId('scroll-area-horizontal-thumb')).toHaveAttribute('data-orientation', 'horizontal')
      await expect.element(screen.getByTestId('scroll-area-horizontal-thumb')).toHaveClass(
        'shrink-0',
        'rounded-sm',
        'bg-state-base-handle',
        'transition-[background-color]',
        'motion-reduce:transition-none',
        'data-[orientation=horizontal]:h-1',
      )
    })
  })

  describe('Props', () => {
    it('should forward className to the viewport', async () => {
      const screen = await renderScrollArea({
        viewportClassName: 'custom-viewport-class',
      })

      await expect.element(screen.getByTestId('scroll-area-viewport')).toHaveClass(
        'size-full',
        'min-h-0',
        'min-w-0',
        'outline-hidden',
        'focus-visible:ring-1',
        'focus-visible:ring-inset',
        'focus-visible:ring-components-input-border-hover',
        'custom-viewport-class',
      )
    })

    it('should let callers control scrollbar inset spacing via margin-based className overrides', async () => {
      const screen = await renderScrollArea({
        verticalScrollbarClassName: 'data-[orientation=vertical]:my-2 data-[orientation=vertical]:-me-3',
        horizontalScrollbarClassName: 'data-[orientation=horizontal]:mx-2 data-[orientation=horizontal]:mb-2',
      })

      await expect.element(screen.getByTestId('scroll-area-vertical-scrollbar')).toHaveClass(
        'data-[orientation=vertical]:my-2',
        'data-[orientation=vertical]:-me-3',
      )
      await expect.element(screen.getByTestId('scroll-area-horizontal-scrollbar')).toHaveClass(
        'data-[orientation=horizontal]:mx-2',
        'data-[orientation=horizontal]:mb-2',
      )
    })
  })

  describe('Corner', () => {
    it('should render the corner export when both axes overflow', async () => {
      const restoreViewportMetrics: Array<() => void> = []

      try {
        const screen = await render(
          <ScrollAreaRoot className="h-40 w-40" data-testid="scroll-area-root">
            <ScrollAreaViewport
              data-testid="scroll-area-viewport"
              ref={(node) => {
                if (!node || restoreViewportMetrics.length > 0)
                  return

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
          </ScrollAreaRoot>,
        )

        await vi.waitFor(() => {
          expect(screen.getByTestId('scroll-area-corner').element()).toBeInTheDocument()
          expect(screen.getByTestId('scroll-area-corner').element()).toHaveClass('bg-transparent')
        })
      }
      finally {
        restoreViewportMetrics.splice(0).forEach(restore => restore())
      }
    })
  })
})
