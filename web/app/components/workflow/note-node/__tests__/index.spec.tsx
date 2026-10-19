import type { NoteNodeType } from '../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { CUSTOM_NOTE_NODE, NOTE_SHOW_AUTHOR_STORAGE_KEY } from '../constants'
import NoteNode from '../index'
import { NoteTheme } from '../types'

const createNoteData = (overrides: Partial<NoteNodeType> = {}): Partial<NoteNodeType> => ({
  title: '',
  desc: '',
  text: '',
  theme: NoteTheme.blue,
  author: 'Alice',
  showAuthor: true,
  width: 240,
  height: 88,
  selected: true,
  ...overrides,
})

const NoteIds = () => {
  const nodes = useNodes()
  return <output aria-label="Canvas notes">{nodes.map((node) => node.id).join(',')}</output>
}

const renderNoteNode = (dataOverrides: Partial<NoteNodeType> = {}) => {
  const data = createNoteData(dataOverrides)
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient)

  return renderWorkflowFlowComponent(
    <>
      <button type="button">Outside note</button>
      <NoteIds />
    </>,
    {
      nodes: [
        createNode({
          id: 'note-1',
          type: CUSTOM_NOTE_NODE,
          data,
          selected: !!data.selected,
          width: 240,
          height: 88,
        }),
      ],
      edges: [],
      reactFlowProps: {
        nodeTypes: {
          [CUSTOM_NOTE_NODE]: NoteNode,
        },
      },
      historyStore: { nodes: [], edges: [] },
      queryClient,
    },
  )
}

const openNoteMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'common.operation.more' }))
}

describe('NoteNode', () => {
  beforeEach(() => {
    localStorage.removeItem(NOTE_SHOW_AUTHOR_STORAGE_KEY)
  })

  it('hides the toolbar for temporary notes', () => {
    renderNoteNode({
      _isTempNode: true,
      showAuthor: false,
    })

    expect(screen.queryByText('workflow.nodes.note.editor.small')).not.toBeInTheDocument()
  })

  it('clears the selected state when clicking outside the note', async () => {
    const user = userEvent.setup()
    renderNoteNode()

    expect(await screen.findByText('workflow.nodes.note.editor.small')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Outside note' }))
    await waitFor(() =>
      expect(screen.queryByText('workflow.nodes.note.editor.small')).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('hides the author and remembers the preference for new notes', async () => {
    const user = userEvent.setup()
    renderNoteNode()

    expect(screen.getByText('Alice')).toBeInTheDocument()
    await openNoteMenu(user)
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'workflow.nodes.note.editor.showAuthor' }),
    )

    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())
    expect(localStorage.getItem(NOTE_SHOW_AUTHOR_STORAGE_KEY)).toBe('false')
  })

  it('removes the note from the canvas from its menu', async () => {
    const user = userEvent.setup()
    renderNoteNode()

    expect(screen.getByRole('status', { name: 'Canvas notes' })).toHaveTextContent('note-1')
    await openNoteMenu(user)
    await user.click(screen.getByRole('menuitem', { name: /common\.operation\.delete/ }))

    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Canvas notes' })).toBeEmptyDOMElement(),
    )
  })
})
