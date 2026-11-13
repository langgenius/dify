import { createNoteEditorStore } from '../store'

describe('note editor store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
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

  it('keeps a dismissed link closed when an earlier anchor request finishes', () => {
    vi.useFakeTimers()
    try {
      const store = createNoteEditorStore()
      const link = document.createElement('a')
      const text = document.createTextNode('Link')
      link.appendChild(text)
      vi.spyOn(window, 'getSelection').mockReturnValue({ focusNode: text } as unknown as Selection)

      store.getState().setSelectedLinkKey('selected-link')
      store.getState().setLinkAnchorElement(true)
      store.getState().dismissLinkEditor()
      vi.runAllTimers()

      expect(store.getState().linkAnchorElement).toBeNull()
      expect(store.getState().linkOperatorShow).toBe(false)
      expect(store.getState().dismissedLinkKey).toBe('selected-link')

      store.getState().setLinkAnchorElement(link)
      expect(store.getState().linkAnchorElement).toBe(link)
      expect(store.getState().dismissedLinkKey).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
