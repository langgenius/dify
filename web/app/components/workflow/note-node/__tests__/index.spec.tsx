import type { NoteNodeType } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { CUSTOM_NOTE_NODE } from '../constants'
import NoteNode from '../index'
import { NoteTheme } from '../types'

const {
  mockHandleEditorChange,
  mockHandleNodeDelete,
  mockHandleNodesCopy,
  mockHandleNodesDuplicate,
  mockHandleShowAuthorChange,
  mockHandleThemeChange,
} = vi.hoisted(() => ({
  mockHandleEditorChange: vi.fn(),
  mockHandleNodeDelete: vi.fn(),
  mockHandleNodesCopy: vi.fn(),
  mockHandleNodesDuplicate: vi.fn(),
  mockHandleShowAuthorChange: vi.fn(),
  mockHandleThemeChange: vi.fn(),
}))

vi.mock('../../hooks/use-nodes-sync-draft', () => ({
  useNodesSyncDraft: () => ({ handleSyncWorkflowDraft: vi.fn() }),
}))
vi.mock('../../collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    canApplyLocalGraphMutation: () => true,
  },
}))

vi.mock('../../hooks/use-nodes-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-nodes-interactions')>()
  return {
    ...actual,
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
  const nodes = [
    createNode({
      id: 'note-1',
      type: CUSTOM_NOTE_NODE,
      data: nodeData,
      selected: !!nodeData.selected,
    }),
  ]

  return renderWorkflowFlowComponent(<button type="button">Outside note</button>, {
    nodes,
    edges: [],
    reactFlowProps: {
      nodeTypes: {
        [CUSTOM_NOTE_NODE]: NoteNode,
      },
    },
    initialStoreState: {
      controlPromptEditorRerenderKey: 0,
    },
  })
}

describe('NoteNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should hide the toolbar for temporary notes', () => {
    renderNoteNode({
      _isTempNode: true,
      showAuthor: false,
    })

    expect(screen.queryByText('workflow.nodes.note.editor.small')).not.toBeInTheDocument()
  })

  it('should clear the selected state when clicking outside the note', async () => {
    const user = userEvent.setup()
    renderNoteNode()

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(await screen.findByText('workflow.nodes.note.editor.small')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Outside note' }))
    await waitFor(() =>
      expect(screen.queryByText('workflow.nodes.note.editor.small')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })
})
