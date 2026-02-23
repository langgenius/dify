import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import DraggableBlockPlugin from '.'

type DraggablePluginMockProps = {
  anchorElem: HTMLElement
  menuComponent: React.ReactNode
  targetLineComponent: React.ReactNode
  isOnMenu: (element: Element) => boolean
}

const mockState = vi.hoisted(() => ({
  rootElement: null as HTMLElement | null,
  draggableProps: null as DraggablePluginMockProps | null,
}))

vi.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [{
    getRootElement: () => mockState.rootElement,
  }],
}))

vi.mock('@lexical/react/LexicalDraggableBlockPlugin', () => ({
  DraggableBlockPlugin_EXPERIMENTAL: (props: DraggablePluginMockProps) => {
    mockState.draggableProps = props
    return (
      <div data-testid="draggable-plugin-experimental">
        {props.menuComponent}
        {props.targetLineComponent}
      </div>
    )
  },
}))

describe('DraggableBlockPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.draggableProps = null
    mockState.rootElement = document.createElement('div')
    document.body.appendChild(mockState.rootElement)
  })

  afterEach(() => {
    mockState.rootElement?.remove()
    mockState.rootElement = null
  })

  // Base render and prop wiring for lexical draggable plugin.
  describe('Rendering', () => {
    it('should pass default anchor and render target line component', () => {
      render(<DraggableBlockPlugin />)

      expect(screen.getByTestId('draggable-plugin-experimental')).toBeInTheDocument()
      expect(mockState.draggableProps?.anchorElem).toBe(document.body)
      expect(screen.getByTestId('draggable-target-line')).toBeInTheDocument()
      expect(mockState.draggableProps?.menuComponent).toBeNull()
    })

    it('should pass custom anchor element to lexical draggable plugin', () => {
      const customAnchor = document.createElement('div')
      render(<DraggableBlockPlugin anchorElem={customAnchor} />)

      expect(mockState.draggableProps?.anchorElem).toBe(customAnchor)
    })
  })

  // Support-drag detection through mousemove events on editor root.
  describe('Drag Support Detection', () => {
    it('should render drag menu when mouse moves over a support-drag element', async () => {
      const supportDragTarget = document.createElement('div')
      supportDragTarget.className = 'support-drag'
      mockState.rootElement?.appendChild(supportDragTarget)

      render(<DraggableBlockPlugin />)
      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()

      fireEvent.mouseMove(supportDragTarget)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should hide drag menu when mouse moves from supported target to unsupported target', async () => {
      const supportDragTarget = document.createElement('div')
      supportDragTarget.className = 'support-drag'
      const normalTarget = document.createElement('div')
      mockState.rootElement?.appendChild(supportDragTarget)
      mockState.rootElement?.appendChild(normalTarget)

      render(<DraggableBlockPlugin />)

      fireEvent.mouseMove(supportDragTarget)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })

      fireEvent.mouseMove(normalTarget)
      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })
    })
  })

  // isOnMenu callback behavior used by Lexical draggable integration.
  describe('isOnMenu Callback', () => {
    it('should return true for elements inside draggable menu and false otherwise', async () => {
      const supportDragTarget = document.createElement('div')
      supportDragTarget.className = 'support-drag'
      mockState.rootElement?.appendChild(supportDragTarget)

      render(<DraggableBlockPlugin />)

      fireEvent.mouseMove(supportDragTarget)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })

      const menuIcon = screen.getByTestId('draggable-menu-icon')
      expect(menuIcon).toBeInTheDocument()

      const normalElement = document.createElement('div')
      document.body.appendChild(normalElement)

      expect(mockState.draggableProps?.isOnMenu(menuIcon)).toBe(true)
      expect(mockState.draggableProps?.isOnMenu(normalElement)).toBe(false)

      normalElement.remove()
    })
  })
})
