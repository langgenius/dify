import type { MentionInputHandle } from '../mention-input'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import MentionInput from '../mention-input'

const placeCaretAtEnd = (element: HTMLElement) => {
  const textNode = element.firstChild
  if (!textNode) throw new Error('Expected editor text node')
  const range = document.createRange()
  range.setStart(textNode, textNode.textContent?.length ?? 0)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const renderInput = (overrides: Partial<React.ComponentProps<typeof MentionInput>> = {}) => {
  const ref = createRef<MentionInputHandle>()
  const props: React.ComponentProps<typeof MentionInput> = {
    ref,
    placeholder: 'Describe a workflow',
    onChange: vi.fn(),
    onHashQueryChange: vi.fn(),
    onEnter: vi.fn(),
    ...overrides,
  }
  render(<MentionInput {...props} />)
  return { ref, props, textbox: screen.getByRole('textbox') }
}

describe('MentionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends and removes an atomic mention while keeping serialized text and ids in sync', () => {
    const { ref, props, textbox } = renderInput()

    act(() => {
      ref.current?.appendMention({ id: 'node-1', title: 'Search' })
    })

    expect(textbox.querySelector('[data-mention-id="node-1"]')).toHaveTextContent('Search')
    expect(props.onChange).toHaveBeenLastCalledWith('【Search】 ', ['node-1'])

    act(() => {
      ref.current?.removeMention('node-1')
    })

    expect(textbox.querySelector('[data-mention-id="node-1"]')).not.toBeInTheDocument()
    expect(props.onChange).toHaveBeenLastCalledWith('', [])
  })

  it('clears both editor content and mention ids through its public handle', () => {
    const { ref, props, textbox } = renderInput()
    act(() => {
      ref.current?.appendMention({ id: 'node-1', title: 'Search' })
      ref.current?.clear()
    })

    expect(textbox).toHaveTextContent('')
    expect(props.onChange).toHaveBeenLastCalledWith('', [])
  })

  it('replaces the active hash query with the selected mention', () => {
    const { ref, props, textbox } = renderInput()
    textbox.textContent = 'review #sea'
    placeCaretAtEnd(textbox)
    fireEvent.input(textbox)

    expect(props.onHashQueryChange).toHaveBeenLastCalledWith('sea')

    act(() => {
      ref.current?.insertMentionAtCaret({ id: 'node-1', title: 'Search' })
    })

    expect(props.onChange).toHaveBeenLastCalledWith('review 【Search】 ', ['node-1'])
    expect(textbox.querySelector('[data-mention-id="node-1"]')).toHaveTextContent('Search')
  })

  it('submits on Enter when the picker does not consume the key', () => {
    const onEnter = vi.fn()
    const { textbox } = renderInput({ onEnter })

    fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(onEnter).toHaveBeenCalledOnce()
  })

  it('lets the open picker consume Enter without submitting', () => {
    const onEnter = vi.fn()
    const onPickerKeyDown = vi.fn().mockReturnValue(true)
    const { textbox } = renderInput({
      isPickerOpen: true,
      onEnter,
      onPickerKeyDown,
    })

    fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(onPickerKeyDown).toHaveBeenCalledOnce()
    expect(onEnter).not.toHaveBeenCalled()
  })

  it('does not submit Enter while an IME composition is active', () => {
    const onEnter = vi.fn()
    const { textbox } = renderInput({ onEnter })

    fireEvent.compositionStart(textbox)
    fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(onEnter).not.toHaveBeenCalled()
  })
})
