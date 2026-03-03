import type { LexicalEditor } from 'lexical'
import type { JSX, RefObject } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { act, render, screen } from '@testing-library/react'
import DraggableBlockPlugin from '..'

type DraggableExperimentalProps = {
  anchorElem: HTMLElement
  menuRef: RefObject<HTMLDivElement>
  targetLineRef: RefObject<HTMLDivElement>
  menuComponent: JSX.Element | null
  targetLineComponent: JSX.Element
  isOnMenu: (element: HTMLElement) => boolean
  onElementChanged: (element: HTMLElement | null) => void
}

type MouseMoveHandler = (event: MouseEvent) => void

const { draggableMockState } = vi.hoisted(() => ({
  draggableMockState: {
    latestProps: null as DraggableExperimentalProps | null,
  },
}))

vi.mock('@lexical/react/LexicalComposerContext')
vi.mock('@lexical/react/LexicalDraggableBlockPlugin', () => ({
  DraggableBlockPlugin_EXPERIMENTAL: (props: DraggableExperimentalProps) => {
    draggableMockState.latestProps = props
    return (
      <div data-testid="draggable-plugin-experimental-mock">
        {props.menuComponent}
        {props.targetLineComponent}
      </div>
    )
  },
}))

function createRootElementMock() {
  let mouseMoveHandler: MouseMoveHandler | null = null
  const addEventListener = vi.fn((eventName: string, handler: EventListenerOrEventListenerObject) => {
    if (eventName === 'mousemove' && typeof handler === 'function')
      mouseMoveHandler = handler as MouseMoveHandler
  })
  const removeEventListener = vi.fn()

  return {
    rootElement: {
      addEventListener,
      removeEventListener,
    } as unknown as HTMLElement,
    addEventListener,
    removeEventListener,
    getMouseMoveHandler: () => mouseMoveHandler,
  }
}

function getRegisteredMouseMoveHandler(
  rootMock: ReturnType<typeof createRootElementMock>,
): MouseMoveHandler {
  const handler = rootMock.getMouseMoveHandler()
  if (!handler)
    throw new Error('Expected mousemove handler to be registered')
  return handler
}

function setupEditorRoot(rootElement: HTMLElement | null) {
  const editor = {
    getRootElement: vi.fn(() => rootElement),
  } as unknown as LexicalEditor

  vi.mocked(useLexicalComposerContext).mockReturnValue([
    editor,
    {},
  ] as unknown as ReturnType<typeof useLexicalComposerContext>)

  return editor
}

describe('DraggableBlockPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    draggableMockState.latestProps = null
  })

  describe('Rendering', () => {
    it('should use body as default anchor and render target line', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)

      render(<DraggableBlockPlugin />)

      expect(draggableMockState.latestProps?.anchorElem).toBe(document.body)
      expect(screen.getByTestId('draggable-target-line')).toBeInTheDocument()
      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
    })

    it('should render with custom anchor when provided', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      const anchorElem = document.createElement('div')

      render(<DraggableBlockPlugin anchorElem={anchorElem} />)

      expect(draggableMockState.latestProps?.anchorElem).toBe(anchorElem)
      expect(screen.getByTestId('draggable-target-line')).toBeInTheDocument()
    })

    it('should return early when editor root element is null', () => {
      const editor = setupEditorRoot(null)

      render(<DraggableBlockPlugin />)

      expect(editor.getRootElement).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('draggable-target-line')).toBeInTheDocument()
      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
    })
  })

  describe('Drag support detection', () => {
    it('should show menu when target has support-drag class', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      render(<DraggableBlockPlugin />)

      const onMove = getRegisteredMouseMoveHandler(rootMock)
      const target = document.createElement('div')
      target.className = 'support-drag'

      act(() => {
        onMove({ target } as unknown as MouseEvent)
      })

      expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
    })

    it('should show menu when target contains a support-drag descendant', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      render(<DraggableBlockPlugin />)

      const onMove = getRegisteredMouseMoveHandler(rootMock)
      const target = document.createElement('div')
      target.appendChild(Object.assign(document.createElement('span'), { className: 'support-drag' }))

      act(() => {
        onMove({ target } as unknown as MouseEvent)
      })

      expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
    })

    it('should show menu when target is inside a support-drag ancestor', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      render(<DraggableBlockPlugin />)

      const onMove = getRegisteredMouseMoveHandler(rootMock)
      const ancestor = document.createElement('div')
      ancestor.className = 'support-drag'
      const child = document.createElement('span')
      ancestor.appendChild(child)

      act(() => {
        onMove({ target: child } as unknown as MouseEvent)
      })

      expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
    })

    it('should hide menu when target does not support drag', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      render(<DraggableBlockPlugin />)

      const onMove = getRegisteredMouseMoveHandler(rootMock)
      const supportDragTarget = document.createElement('div')
      supportDragTarget.className = 'support-drag'

      act(() => {
        onMove({ target: supportDragTarget } as unknown as MouseEvent)
      })
      expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()

      const plainTarget = document.createElement('div')
      act(() => {
        onMove({ target: plainTarget } as unknown as MouseEvent)
      })

      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
    })

    it('should keep menu hidden when event target becomes null', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      render(<DraggableBlockPlugin />)

      const onMove = getRegisteredMouseMoveHandler(rootMock)
      const supportDragTarget = document.createElement('div')
      supportDragTarget.className = 'support-drag'
      act(() => {
        onMove({ target: supportDragTarget } as unknown as MouseEvent)
      })
      expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      act(() => {
        onMove({ target: null } as unknown as MouseEvent)
      })

      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
    })
  })

  describe('Forwarded callbacks', () => {
    it('should forward isOnMenu and detect menu membership correctly', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      render(<DraggableBlockPlugin />)

      const onMove = getRegisteredMouseMoveHandler(rootMock)
      const supportDragTarget = document.createElement('div')
      supportDragTarget.className = 'support-drag'
      act(() => {
        onMove({ target: supportDragTarget } as unknown as MouseEvent)
      })

      const renderedMenu = screen.getByTestId('draggable-menu')
      const isOnMenu = draggableMockState.latestProps?.isOnMenu
      if (!isOnMenu)
        throw new Error('Expected isOnMenu callback')

      const menuIcon = screen.getByTestId('draggable-menu-icon')
      const outsideElement = document.createElement('div')

      expect(isOnMenu(menuIcon)).toBe(true)
      expect(isOnMenu(renderedMenu)).toBe(true)
      expect(isOnMenu(outsideElement)).toBe(false)
    })

    it('should register and cleanup mousemove listener on mount and unmount', () => {
      const rootMock = createRootElementMock()
      setupEditorRoot(rootMock.rootElement)
      const { unmount } = render(<DraggableBlockPlugin />)

      const onMove = getRegisteredMouseMoveHandler(rootMock)
      expect(rootMock.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function))

      unmount()

      expect(rootMock.removeEventListener).toHaveBeenCalledWith('mousemove', onMove)
    })
  })
})
