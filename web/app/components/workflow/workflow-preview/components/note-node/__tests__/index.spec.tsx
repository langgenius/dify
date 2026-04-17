import type { NoteNodeType } from '@/app/components/workflow/note-node/types'
import { render, screen } from '@testing-library/react'
import { NoteTheme } from '@/app/components/workflow/note-node/types'
import NoteNode from '../index'

const emptyValue = JSON.stringify({ root: { children: [] } })

const createNoteData = (overrides: Partial<NoteNodeType> = {}): NoteNodeType => ({
  title: 'Note',
  desc: '',
  type: 'note' as NoteNodeType['type'],
  text: emptyValue,
  theme: NoteTheme.blue,
  author: 'Alice',
  showAuthor: true,
  width: 320,
  height: 180,
  selected: false,
  ...overrides,
})

const createNoteProps = (overrides: Partial<React.ComponentProps<typeof NoteNode>> = {}): React.ComponentProps<typeof NoteNode> => ({
  id: 'note-node-1',
  type: 'note-node',
  selected: false,
  zIndex: 1,
  isConnectable: true,
  dragging: false,
  xPos: 0,
  yPos: 0,
  dragHandle: undefined,
  data: createNoteData(),
  ...overrides,
})

describe('workflow preview note node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The preview node should expose the same readonly editor surface and metadata as the live note node.
  describe('Rendering', () => {
    it('should render the readonly note editor, author, and themed frame', () => {
      const { container } = render(
        <NoteNode {...createNoteProps()} />,
      )

      const noteRoot = container.firstElementChild as HTMLElement

      expect(screen.getByRole('textbox')).toBeInTheDocument()
      expect(screen.getByText('workflow.nodes.note.editor.placeholder')).toBeInTheDocument()
      expect(screen.getByText('Alice')).toBeInTheDocument()
      expect(noteRoot).toHaveClass('bg-util-colors-blue-blue-50', 'border-black/5')
      expect(noteRoot).toHaveStyle({
        width: '320px',
        height: '180px',
      })
    })

    it('should apply selected styles and hide the author block when showAuthor is disabled', () => {
      const { container } = render(
        <NoteNode
          {...createNoteProps({
            selected: true,
            data: createNoteData({
              theme: NoteTheme.pink,
              selected: true,
              showAuthor: false,
            }),
          })}
        />,
      )

      const noteRoot = container.firstElementChild as HTMLElement

      expect(noteRoot).toHaveClass('bg-util-colors-pink-pink-50', 'border-util-colors-pink-pink-300')
      expect(container.querySelector('.cursor-text')).toBeInTheDocument()
      expect(container.querySelector('.nodrag.nopan.nowheel')).toBeInTheDocument()
      expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    })
  })
})
