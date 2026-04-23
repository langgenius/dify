import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('cancels a newly created empty link when pressing Escape', () => {
    const store = createNoteEditorStore()
    const anchor = document.createElement('button')
    const portalRoot = document.createElement('div')
    document.body.appendChild(anchor)
    document.body.appendChild(portalRoot)
    store.setState({
      linkAnchorElement: anchor,
      linkOperatorShow: false,
      selectedLinkUrl: '',
    })

    render(
      <NoteEditorContext.Provider value={store}>
        <LinkEditorComponent containerElement={portalRoot} />
      </NoteEditorContext.Provider>,
    )

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(mockHandleUnlink).toHaveBeenCalledTimes(1)
    expect(mockHandleSaveLink).not.toHaveBeenCalled()
  })

  it('cancels a newly created empty link when clicking outside the editor', async () => {
    const store = createNoteEditorStore()
    const anchor = document.createElement('button')
    const portalRoot = document.createElement('div')
    document.body.appendChild(anchor)
    document.body.appendChild(portalRoot)
    store.setState({
      linkAnchorElement: anchor,
      linkOperatorShow: false,
      selectedLinkUrl: '',
    })

    render(
      <NoteEditorContext.Provider value={store}>
        <LinkEditorComponent containerElement={portalRoot} />
      </NoteEditorContext.Provider>,
    )

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    fireEvent.mouseUp(document.body)
    fireEvent.click(document.body)

    await waitFor(() => {
      expect(mockHandleUnlink).toHaveBeenCalledTimes(1)
    })
    expect(mockHandleSaveLink).not.toHaveBeenCalled()
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

  it('saves the edited url when pressing Enter', () => {
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

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(mockHandleSaveLink).toHaveBeenCalledWith('https://example.com')
  })
})
