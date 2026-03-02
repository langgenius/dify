import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DraggableBlockPlugin from '.'

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

function appendChildToRoot(rootElement: HTMLElement, className = '') {
  const element = document.createElement('div')
  element.className = className
  rootElement.appendChild(element)
  return element
}

describe('DraggableBlockPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should use body as default anchor and render target line', () => {
      renderWithEditor()

      const targetLine = screen.getByTestId('draggable-target-line')
      expect(targetLine).toBeInTheDocument()
      expect(document.body.contains(targetLine)).toBe(true)
      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
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

  describe('Drag Support Detection', () => {
    it('should render drag menu when mouse moves over a support-drag element', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      expect(screen.queryByTestId('draggable-menu')).not.toBeInTheDocument()
      fireEvent.mouseMove(supportDragTarget)

      await waitFor(() => {
        expect(screen.getByTestId('draggable-menu')).toBeInTheDocument()
      })
    })

    it('should hide drag menu when support-drag target is removed and mouse moves again', async () => {
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

  describe('Menu Detection Contract', () => {
    it('should render menu with draggable-block-menu class and keep non-menu elements outside it', async () => {
      const rootElement = renderWithEditor()
      const supportDragTarget = appendChildToRoot(rootElement, 'support-drag')

      fireEvent.mouseMove(supportDragTarget)

      const menuIcon = await screen.findByTestId('draggable-menu-icon')
      expect(menuIcon.closest('.draggable-block-menu')).not.toBeNull()

      const normalElement = document.createElement('div')
      document.body.appendChild(normalElement)
      expect(normalElement.closest('.draggable-block-menu')).toBeNull()
      normalElement.remove()
    })
  })
})
