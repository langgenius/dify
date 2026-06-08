import type { createNoteEditorStore } from '../../../store'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { NoteEditorContextProvider } from '../../../context'
import { useNoteEditorStore } from '../../../store'
import LinkEditorPlugin from '../index'

type NoteEditorStore = ReturnType<typeof createNoteEditorStore>

const emptyValue = JSON.stringify({ root: { children: [] } })

const StoreProbe = ({
  onReady,
}: {
  onReady?: (store: NoteEditorStore) => void
}) => {
  const store = useNoteEditorStore()

  useEffect(() => {
    onReady?.(store)
  }, [onReady, store])

  return null
}

describe('LinkEditorPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Without an anchor element the plugin should stay hidden.
  describe('Visibility', () => {
    it('should render nothing when no link anchor is selected', () => {
      const { container } = render(
        <NoteEditorContextProvider value={emptyValue}>
          <LinkEditorPlugin containerElement={null} />
        </NoteEditorContextProvider>,
      )

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should render the link editor when the store has an anchor element', async () => {
      let store: NoteEditorStore | null = null

      render(
        <NoteEditorContextProvider value={emptyValue}>
          <StoreProbe onReady={instance => (store = instance)} />
          <LinkEditorPlugin containerElement={document.createElement('div')} />
        </NoteEditorContextProvider>,
      )

      await waitFor(() => {
        expect(store).not.toBeNull()
      })

      act(() => {
        store!.setState({
          linkAnchorElement: document.createElement('a'),
          linkOperatorShow: false,
          selectedLinkUrl: 'https://example.com',
        })
      })

      await waitFor(() => {
        expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()
      })
    })
  })
})
