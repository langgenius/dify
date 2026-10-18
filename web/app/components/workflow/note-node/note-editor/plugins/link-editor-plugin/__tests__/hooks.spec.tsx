import { $isLinkNode } from '@lexical/link'
import { act, waitFor } from '@testing-library/react'
import { $getRoot, CLICK_COMMAND } from 'lexical'
import { toast } from '@/app/notifications'
import { renderNoteHook } from '../../../__tests__/test-helpers'
import { useLink, useOpenLink } from '../hooks'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('rejects invalid URLs and saves a URL verbatim before unlinking the selected text', async () => {
  const hook = await renderNoteHook(useLink)
  hook.update(() => hook.value.handleSaveLink('not-a-valid-url'))
  expect(toast.error).toHaveBeenCalledWith('workflow.nodes.note.editor.invalidUrl')
  hook.editor
    .getEditorState()
    .read(() => expect($isLinkNode($getRoot().getAllTextNodes()[0]!.getParent())).toBe(false))
  const url = 'https://dify.ai/docs?first=1&second=2'
  hook.update(() => hook.value.handleSaveLink(url))
  hook.editor.getEditorState().read(() => {
    const link = $getRoot().getAllTextNodes()[0]!.getParent()
    expect($isLinkNode(link) && link.getURL()).toBe(url)
  })
  hook.update(() => hook.value.handleUnlink())
  hook.editor.getEditorState().read(() => {
    expect($isLinkNode($getRoot().getAllTextNodes()[0]!.getParent())).toBe(false)
    expect($getRoot().getTextContent()).toBe('Selected note')
  })
})

it('opens selected link controls, honors dismissal, and clears them when selection leaves the link', async () => {
  const hook = await renderNoteHook(() => {
    useOpenLink()
    return useLink()
  })
  hook.update(() => hook.value.handleSaveLink('https://dify.ai/docs'))
  await waitFor(() => expect(hook.store.getState().linkOperatorShow).toBe(true))
  act(() => hook.store.getState().dismissLinkEditor())
  hook.update(() => $getRoot().getAllTextNodes()[0]!.setStyle('font-size: 18px'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(hook.store.getState().linkOperatorShow).toBe(false)
  hook.update(() => hook.value.handleUnlink())
  await waitFor(() =>
    expect(hook.store.getState()).toMatchObject({
      selectedIsLink: false,
      linkOperatorShow: false,
      linkAnchorElement: null,
    }),
  )
})

it.each([{}, { ctrlKey: true }, { metaKey: true }])(
  'handles clicks on nested link content: %o',
  async (modifiers) => {
    const hook = await renderNoteHook(useOpenLink)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const anchor = document.createElement('a')
    anchor.className = 'note-editor-theme_link'
    anchor.href = 'https://dify.ai/clicked'
    const text = document.createElement('span')
    anchor.append(text)
    const event = new MouseEvent('click', { bubbles: true, ...modifiers })
    text.dispatchEvent(event)
    act(() => {
      hook.editor.dispatchCommand(CLICK_COMMAND, event)
    })
    if ('ctrlKey' in modifiers || 'metaKey' in modifiers) {
      await waitFor(() => expect(open).toHaveBeenCalledWith('https://dify.ai/clicked', '_blank'))
    } else {
      await waitFor(() =>
        expect(hook.store.getState()).toMatchObject({
          selectedLinkUrl: 'https://dify.ai/clicked',
          linkAnchorElement: anchor,
          linkOperatorShow: true,
        }),
      )
      expect(open).not.toHaveBeenCalled()
    }
  },
)

it('cancels queued link updates when the hook unmounts', async () => {
  const hook = await renderNoteHook(useOpenLink)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  vi.useFakeTimers()
  const anchor = document.createElement('a')
  anchor.className = 'note-editor-theme_link'
  anchor.href = 'https://dify.ai'
  const event = new MouseEvent('click')
  anchor.dispatchEvent(event)
  act(() => {
    hook.editor.dispatchCommand(CLICK_COMMAND, event)
  })
  hook.unmount()
  act(() => vi.runAllTimers())
  expect(hook.store.getState()).toMatchObject({ linkOperatorShow: false, linkAnchorElement: null })
})
