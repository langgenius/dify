import { describe, expect, it } from 'vitest'
import { renderMarkdownLiveEditorContent, serializeMarkdownLiveEditorNode } from '../shared'

describe('markdown reference chip', () => {
  it('renders a nested file reference as one chip while preserving its full path', () => {
    const editor = document.createElement('div')

    renderMarkdownLiveEditorContent(editor, 'See [sdf](<ddd/sdf>) for details.')

    const reference = editor.querySelector<HTMLElement>('[data-reference-path]')
    const chips = reference?.querySelectorAll(':scope > span')

    expect(reference).not.toBeNull()
    expect(reference?.dataset.referencePath).toBe('ddd/sdf')
    expect(chips).toHaveLength(1)
    expect(chips?.[0]).toHaveTextContent('sdf')
    expect(chips?.[0]).not.toHaveTextContent('ddd')
    expect(serializeMarkdownLiveEditorNode(editor)).toBe('See [sdf](<ddd/sdf>) for details.')
  })
})
