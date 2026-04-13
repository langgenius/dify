import { fireEvent, render, screen } from '@testing-library/react'
import NoteEditorContext from '../../../context'
import { createNoteEditorStore } from '../../../store'
import LinkEditorComponent from '../component'

const mockHandleSaveLink = vi.hoisted(() => vi.fn())
const mockHandleUnlink = vi.hoisted(() => vi.fn())

vi.mock('../hooks', () => ({
  useLink: () => ({
    handleSaveLink: mockHandleSaveLink,
    handleUnlink: mockHandleUnlink,
  }),
}))

describe('link editor component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the inline link editor and saves the edited url', () => {
    const store = createNoteEditorStore()
    const anchor = document.createElement('button')
    const portalRoot = document.createElement('div')
    document.body.appendChild(anchor)
    document.body.appendChild(portalRoot)
    store.setState({
      linkAnchorElement: anchor,
      linkOperatorShow: false,
      selectedLinkUrl: 'https://example.com',
    })

    render(
      <NoteEditorContext.Provider value={store}>
        <LinkEditorComponent containerElement={portalRoot} />
      </NoteEditorContext.Provider>,
    )

    expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.ok' }))

    expect(mockHandleSaveLink).toHaveBeenCalledWith('https://example.com')
  })
})
