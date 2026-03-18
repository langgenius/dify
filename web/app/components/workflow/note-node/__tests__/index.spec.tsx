import type { Node as ReactFlowNode } from 'reactflow'
import type { NoteNodeType } from '../types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { CUSTOM_NOTE_NODE } from '../constants'
import NoteNode from '../index'
import { NoteTheme } from '../types'

const {
  mockHandleEditorChange,
  mockHandleNodeDataUpdateWithSyncDraft,
  mockHandleNodeDelete,
  mockHandleNodesCopy,
  mockHandleNodesDuplicate,
  mockHandleShowAuthorChange,
  mockHandleThemeChange,
  mockSetShortcutsEnabled,
} = vi.hoisted(() => ({
  mockHandleEditorChange: vi.fn(),
  mockHandleNodeDataUpdateWithSyncDraft: vi.fn(),
  mockHandleNodeDelete: vi.fn(),
  mockHandleNodesCopy: vi.fn(),
  mockHandleNodesDuplicate: vi.fn(),
  mockHandleShowAuthorChange: vi.fn(),
  mockHandleThemeChange: vi.fn(),
  mockSetShortcutsEnabled: vi.fn(),
}))

vi.mock('../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks')>()
  return {
    ...actual,
    useNodeDataUpdate: () => ({
      handleNodeDataUpdateWithSyncDraft: mockHandleNodeDataUpdateWithSyncDraft,
    }),
    useNodesInteractions: () => ({
      handleNodesCopy: mockHandleNodesCopy,
      handleNodesDuplicate: mockHandleNodesDuplicate,
      handleNodeDelete: mockHandleNodeDelete,
    }),
  }
})

vi.mock('../hooks', () => ({
  useNote: () => ({
    handleThemeChange: mockHandleThemeChange,
    handleEditorChange: mockHandleEditorChange,
    handleShowAuthorChange: mockHandleShowAuthorChange,
  }),
}))

vi.mock('../../workflow-history-store', () => ({
  useWorkflowHistoryStore: () => ({
    setShortcutsEnabled: mockSetShortcutsEnabled,
  }),
}))

const createNoteData = (overrides: Partial<NoteNodeType> = {}): NoteNodeType => ({
  title: '',
  desc: '',
  type: '' as unknown as NoteNodeType['type'],
  text: '',
  theme: NoteTheme.blue,
  author: 'Alice',
  showAuthor: true,
  width: 240,
  height: 88,
  selected: true,
  ...overrides,
})

const renderNoteNode = (dataOverrides: Partial<NoteNodeType> = {}) => {
  const nodeData = createNoteData(dataOverrides)
  const nodes: Array<ReactFlowNode<NoteNodeType>> = [
    {
      id: 'note-1',
      type: CUSTOM_NOTE_NODE,
      position: { x: 0, y: 0 },
      data: nodeData,
      selected: !!nodeData.selected,
    },
  ]

  return renderWorkflowComponent(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow
          fitView
          nodes={nodes}
          edges={[]}
          nodeTypes={{
            [CUSTOM_NOTE_NODE]: NoteNode,
          }}
        />
      </ReactFlowProvider>
    </div>,
    {
      initialStoreState: {
        controlPromptEditorRerenderKey: 0,
      },
    },
  )
}

describe('NoteNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the toolbar and author for a selected persistent note', async () => {
    renderNoteNode()

    expect(screen.getByText('Alice')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('workflow.nodes.note.editor.small')).toBeInTheDocument()
    })
  })

  it('should hide the toolbar for temporary notes', () => {
    renderNoteNode({
      _isTempNode: true,
      showAuthor: false,
    })

    expect(screen.queryByText('workflow.nodes.note.editor.small')).not.toBeInTheDocument()
  })

  it('should clear the selected state when clicking outside the note', async () => {
    renderNoteNode()

    fireEvent.click(document.body)

    await waitFor(() => {
      expect(mockHandleNodeDataUpdateWithSyncDraft).toHaveBeenCalledWith({
        id: 'note-1',
        data: {
          selected: false,
        },
      })
    })
  })
})
