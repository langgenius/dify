import { act, renderHook } from '@testing-library/react'
import NoteEditorContext from '../context'
import { createNoteEditorStore, useNoteEditorStore, useStore } from '../store'

describe('note editor store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stores selection state and link metadata', () => {
    const store = createNoteEditorStore()

    store.getState().setLinkOperatorShow(true)
    store.getState().setSelectedIsBold(true)
    store.getState().setSelectedIsItalic(true)
    store.getState().setSelectedIsStrikeThrough(true)
    store.getState().setSelectedLinkUrl('https://dify.ai')
    store.getState().setSelectedIsLink(true)
    store.getState().setSelectedIsBullet(true)

    expect(store.getState()).toMatchObject({
      linkOperatorShow: true,
      selectedIsBold: true,
      selectedIsItalic: true,
      selectedIsStrikeThrough: true,
      selectedLinkUrl: 'https://dify.ai',
      selectedIsLink: true,
      selectedIsBullet: true,
    })
  })

  it('resolves the current selection parent as the link anchor element', () => {
    vi.useFakeTimers()
    const store = createNoteEditorStore()
    const parent = document.createElement('span')
    const textNode = document.createTextNode('selected-text')
    parent.appendChild(textNode)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      focusNode: textNode,
    } as unknown as Selection)

    store.getState().setLinkAnchorElement(true)
    vi.runAllTimers()

    expect(store.getState().linkAnchorElement).toBe(parent)

    store.getState().setLinkAnchorElement(false)
    expect(store.getState().linkAnchorElement).toBeNull()

    vi.useRealTimers()
  })

  it('reads note editor state from context hooks', () => {
    const store = createNoteEditorStore()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <NoteEditorContext.Provider value={store}>
        {children}
      </NoteEditorContext.Provider>
    )

    const { result: selectedResult } = renderHook(() => useStore(state => state.selectedIsBold), { wrapper })
    const { result: storeResult } = renderHook(() => useNoteEditorStore(), { wrapper })

    act(() => {
      storeResult.current.getState().setSelectedIsBold(true)
    })

    expect(selectedResult.current).toBe(true)
    expect(storeResult.current).toBe(store)
  })

  it('throws when the note editor store provider is missing', () => {
    expect(() => renderHook(() => useStore(state => state.selectedIsBold))).toThrow(
      'Missing NoteEditorContext.Provider in the tree',
    )
  })
})
