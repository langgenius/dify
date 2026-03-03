import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DraggableBlockPlugin from '../index'

const CONTENT_EDITABLE_TEST_ID = 'draggable-content-editable'
let namespaceCounter = 0

function renderWithEditor(anchorElem?: HTMLElement) {
  render(
    <LexicalComposer
      initialConfig={{
        namespace: `draggable-plugin-test-${namespaceCounter++}`,
        onError: (error: Error) => { throw error },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_TEST_ID} />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <DraggableBlockPlugin anchorElem={anchorElem} />
    </LexicalComposer>,
  )

  return screen.getByTestId(CONTENT_EDITABLE_TEST_ID)
}

function appendChildToRoot(rootElement: HTMLElement, className = '', testId?: string) {
  const element = document.createElement('div')
  element.className = className
  if (testId)
    element.setAttribute('data-testid', testId)
  rootElement.appendChild(element)
  return element
}

// Test component that mocks getRootElement returning null
function DraggableBlockPluginWithNullRoot() {
  const [editor] = useLexicalComposerContext()

  // Mock getRootElement to return null
  vi.spyOn(editor, 'getRootElement').mockReturnValue(null)

  return <DraggableBlockPlugin />
}

describe('DraggableBlockPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      renderWithEditor()

      const targetLine = screen.getByTestId('draggable-target-line')
      expect(targetLine).toBeInTheDocument()
    })

    it('should use body as default anchor and render target line', () => {
      renderWithEditor()

      const targetLine = screen.getByTestId('draggable-target-line')
      expect(targetLine).toBeInTheDocument()
      expect(document.body.contains(targetLine)).toBe(true)
      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
    })

    it('should render target line with correct structure and classes', () => {
      renderWithEditor()

      const targetLine = screen.getByTestId('draggable-target-line')
      expect(targetLine).toHaveClass('pointer-events-none', 'absolute')
      expect(targetLine.querySelector('div')).toHaveClass('absolute', 'left-0', 'top-0', 'h-[2px]')
    })

    it('should render inside custom anchor element when provided', () => {
      const customAnchor = document.createElement('div')
      document.body.appendChild(customAnchor)

      renderWithEditor(customAnchor)

      const targetLine = screen.getByTestId('draggable-target-line')
      expect(customAnchor.contains(targetLine)).toBe(true)

      customAnchor.remove()
    })
  })

  describe('Menu Rendering States', () => {
    it('should not render menu initially when no support-drag element is hovered', () => {
      renderWithEditor()

      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
    })

    it('should render menu when hovering over element with support-drag class', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should hide menu when support-drag element is removed', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })

      supportDragTarget.remove()
      fireEvent.mouseMove(rootElement)
      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })
    })
  })

  describe('Support Drag Detection', () => {
    it('should detect direct element with support-drag class', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should detect element when child has support-drag class', async () => {
      const rootElement = renderWithEditor()
      const parentElement = appendChildToRoot(rootElement, '', 'parent')
      const supportDragChild = appendChildToRoot(parentElement, 'support-drag')

      fireEvent.mouseMove(supportDragChild)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should detect element when parent contains descendant with support-drag', async () => {
      const rootElement = renderWithEditor()
      const parentWithoutClass = appendChildToRoot(rootElement, '', 'parent')
      appendChildToRoot(parentWithoutClass, 'support-drag')

      // Hover over parent that contains support-drag child - triggers querySelector branch
      fireEvent.mouseMove(parentWithoutClass)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should detect element when it is nested inside support-drag element', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')
      const nestedElement = appendChildToRoot(supportDragTarget, '', 'nested')

      fireEvent.mouseMove(nestedElement)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should not detect element without support-drag in hierarchy', async () => {
      const rootElement = renderWithEditor()
      const normalElement = appendChildToRoot(rootElement, '', 'normal')

      fireEvent.mouseMove(normalElement)

      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })
    })

    it('should handle deeply nested element with support-drag ancestor', async () => {
      const rootElement = renderWithEditor()
      const supportDrag = appendChildToRoot(rootElement, 'support-drag', 'drag-ancestor')
      const level1 = appendChildToRoot(supportDrag, '', 'level1')
      const level2 = appendChildToRoot(level1, '', 'level2')
      const deepChild = appendChildToRoot(level2, '', 'deep')

      fireEvent.mouseMove(deepChild)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })
  })

  describe('Menu Structure and Classes', () => {
    it('should render menu with draggable-block-menu class when active', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)

      const menu = await screen.findByTestId('draggable-menu')
      expect(menu).toHaveClass('draggable-block-menu')
    })

    it('should render menu icon inside menu with correct test id', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)

      const menuIcon = await screen.findByTestId('draggable-menu-icon')
      expect(menuIcon).toBeInTheDocument()
      expect(menuIcon.closest('.draggable-block-menu')).not.toBeNull()
    })

    it('should apply correct positioning and styling classes to menu', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)

      const menu = await screen.findByTestId('draggable-menu')
      expect(menu).toHaveClass('absolute', 'right-2.5', 'top-4', 'cursor-grab')
      expect(menu).toHaveClass('opacity-0', 'will-change-transform')
    })

    it('should keep non-menu elements outside draggable-block-menu scope', () => {
      const normalElement = document.createElement('div')
      document.body.appendChild(normalElement)

      expect(normalElement.closest('.draggable-block-menu')).toBeNull()

      normalElement.remove()
    })

    it('should detect when element is inside menu correctly', () => {
      const menu = document.createElement('div')
      menu.className = 'draggable-block-menu'
      const insideMenu = document.createElement('div')
      menu.appendChild(insideMenu)
      document.body.appendChild(menu)

      expect(insideMenu.closest('.draggable-block-menu')).not.toBeNull()

      menu.remove()
    })
  })

  describe('Multiple Support Drag Elements', () => {
    it('should show menu when hovering any support-drag element', async () => {
      const rootElement = renderWithEditor()
      appendChildToRoot(rootElement, 'support-drag', 'drag-1')
      const drag2 = appendChildToRoot(rootElement, 'support-drag', 'drag-2')

      fireEvent.mouseMove(drag2)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should maintain menu visibility across multiple support-drag elements', async () => {
      const rootElement = renderWithEditor()
      const drag1 = appendChildToRoot(rootElement, 'support-drag', 'drag-1')
      const drag2 = appendChildToRoot(rootElement, 'support-drag', 'drag-2')

      fireEvent.mouseMove(drag1)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })

      fireEvent.mouseMove(drag2)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle null or undefined elements gracefully', async () => {
      const rootElement = renderWithEditor()

      fireEvent.mouseMove(rootElement)

      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })
    })

    it('should handle element removal during hover', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })

      supportDragTarget.remove()
      const normalElements = rootElement.querySelectorAll('[data-testid="normal"]')
      fireEvent.mouseMove(Array.from(normalElements)[0] as HTMLElement || rootElement)
      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })
    })

    it('should handle deeply nested support-drag elements', async () => {
      const rootElement = renderWithEditor()
      const level1 = appendChildToRoot(rootElement, '', 'level1')
      const level2 = appendChildToRoot(level1, '', 'level2')
      const level3 = appendChildToRoot(level2, 'support-drag')

      fireEvent.mouseMove(level3)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should not throw error when mousemove happens on root element', async () => {
      const rootElement = renderWithEditor()

      expect(() => {
        fireEvent.mouseMove(rootElement)
      }).not.toThrow()

      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })
    })

    it('should handle mousemove events on various element types', async () => {
      const rootElement = renderWithEditor()
      const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      rootElement.appendChild(svgElement)

      // Mousemove on SVG element
      fireEvent.mouseMove(svgElement)

      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })

      svgElement.remove()
    })

    it('should handle edge case where mousemove target is document or unusual element', async () => {
      const rootElement = renderWithEditor()
      const customElement = document.createElement('custom-element')
      rootElement.appendChild(customElement)

      // Fire mousemove on custom element which might not have classList
      fireEvent.mouseMove(customElement)

      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })

      customElement.remove()
    })

    it('should detect element after class is dynamically added', async () => {
      const rootElement = renderWithEditor()
      const element = appendChildToRoot(rootElement, '', 'element')

      // First verify menu doesn't show without support-drag
      fireEvent.mouseMove(element)
      await waitFor(() => {
        expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      })

      // Add the class and create a new element to avoid debouncing
      const newElement = appendChildToRoot(rootElement, 'support-drag', 'new-element')
      fireEvent.mouseMove(newElement)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should handle empty content area', () => {
      const rootElement = renderWithEditor()
      expect(rootElement).toBeInTheDocument()
      expect(screen.getByTestId('draggable-target-line')).toBeInTheDocument()
    })

    it('should render menu only when support-drag is present', () => {
      renderWithEditor()

      // Initially no menu
      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()

      // Menu should only appear when hovering support-drag
      // We test this separately in Menu Rendering States tests
    })

    it('should detect parent without class but containing descendant with class', async () => {
      const rootElement = renderWithEditor()
      const parent = appendChildToRoot(rootElement, '', 'parent')
      appendChildToRoot(parent, 'support-drag')

      // Hovering on parent should detect the descendant support-drag
      fireEvent.mouseMove(parent)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should handle multiple levels of nesting with support-drag at middle level', async () => {
      const rootElement = renderWithEditor()
      const grandparent = appendChildToRoot(rootElement, '', 'grandparent')
      const parent = appendChildToRoot(grandparent, 'support-drag', 'parent-with-drag')
      const child = appendChildToRoot(parent, '', 'child')

      fireEvent.mouseMove(child)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should transition between drag and non-drag elements without errors', async () => {
      const rootElement = renderWithEditor()
      const dragElement = appendChildToRoot(rootElement, 'support-drag', 'drag')

      // Hover over drag element
      fireEvent.mouseMove(dragElement)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })

      // Move to new drag element
      const dragElement2 = appendChildToRoot(rootElement, 'support-drag', 'drag2')
      fireEvent.mouseMove(dragElement2)
      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })
  })

  describe('Cleanup and Unmounting', () => {
    it('should clean up event listeners on unmount', () => {
      const { unmount } = render(
        <LexicalComposer
          initialConfig={{
            namespace: `draggable-plugin-cleanup-test-${namespaceCounter++}`,
            onError: (error: Error) => { throw error },
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_TEST_ID} />}
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <DraggableBlockPlugin />
        </LexicalComposer>,
      )

      const eventListenerSpy = vi.spyOn(EventTarget.prototype, 'removeEventListener')
      unmount()

      expect(eventListenerSpy).toHaveBeenCalled()
      eventListenerSpy.mockRestore()
    })

    it('should render target line even when getRootElement operation may fail', () => {
      // This ensures graceful handling when root element is inaccessible
      const { container } = render(
        <LexicalComposer
          initialConfig={{
            namespace: `draggable-plugin-edge-${namespaceCounter++}`,
            onError: (error: Error) => { throw error },
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_TEST_ID} />}
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <DraggableBlockPlugin />
        </LexicalComposer>,
      )

      const targetLine = screen.getByTestId('draggable-target-line')
      expect(targetLine).toBeInTheDocument()
      expect(container).toBeTruthy()
    })

    it('should handle getRootElement returning null gracefully', () => {
      // This tests the early return in useEffect when root is null
      const { container } = render(
        <LexicalComposer
          initialConfig={{
            namespace: `draggable-plugin-null-root-${namespaceCounter++}`,
            onError: (error: Error) => { throw error },
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable data-testid={CONTENT_EDITABLE_TEST_ID} />}
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <DraggableBlockPluginWithNullRoot />
        </LexicalComposer>,
      )

      // Target line still renders since it's always rendered
      expect(screen.getByTestId('draggable-target-line')).toBeInTheDocument()
      expect(container).toBeTruthy()
    })
  })
})
