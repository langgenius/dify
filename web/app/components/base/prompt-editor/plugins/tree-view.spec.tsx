import type { LexicalEditor } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { render, screen, waitFor } from '@testing-library/react'
import { CaptureEditorPlugin } from './test-utils'
import TreeViewPlugin from './tree-view'

const { mockTreeView } = vi.hoisted(() => ({
  mockTreeView: vi.fn(),
}))

vi.mock('@lexical/react/LexicalTreeView', () => ({
  TreeView: (props: unknown) => {
    mockTreeView(props)
    return <div data-testid="lexical-tree-view" />
  },
}))

describe('TreeViewPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render lexical tree view with expected classes and current editor', async () => {
    let editor: LexicalEditor | null = null

    render(
      <LexicalComposer
        initialConfig={{
          namespace: 'tree-view-plugin-test',
          onError: (error: Error) => {
            throw error
          },
        }}
      >
        <TreeViewPlugin />
        <CaptureEditorPlugin onReady={(value) => {
          editor = value
        }}
        />
      </LexicalComposer>,
    )

    await waitFor(() => {
      expect(editor).not.toBeNull()
    })
    expect(screen.getByTestId('lexical-tree-view')).toBeInTheDocument()

    const firstCallProps = mockTreeView.mock.calls[0][0] as Record<string, unknown>

    expect(firstCallProps.editor).toBe(editor)
    expect(firstCallProps.viewClassName).toBe('tree-view-output')
    expect(firstCallProps.treeTypeButtonClassName).toBe('debug-treetype-button')
    expect(firstCallProps.timeTravelPanelClassName).toBe('debug-timetravel-panel')
    expect(firstCallProps.timeTravelButtonClassName).toBe('debug-timetravel-button')
    expect(firstCallProps.timeTravelPanelSliderClassName).toBe('debug-timetravel-panel-slider')
    expect(firstCallProps.timeTravelPanelButtonClassName).toBe('debug-timetravel-panel-button')
  })
})
