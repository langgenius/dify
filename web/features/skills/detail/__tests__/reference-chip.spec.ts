import { within } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderMarkdownLiveEditorContent, serializeMarkdownLiveEditorNode } from '../shared'

describe('markdown reference chip', () => {
  it('renders a nested file reference as one chip while preserving its full path', () => {
    const editor = document.createElement('div')

    renderMarkdownLiveEditorContent(editor, 'See [sdf](<ddd/sdf>) for details.')

    const references = within(editor).getAllByRole('button', { name: 'sdf' })
    expect(references).toHaveLength(1)
    expect(references[0]).not.toHaveTextContent('ddd')
    expect(serializeMarkdownLiveEditorNode(editor)).toBe('See [sdf](<ddd/sdf>) for details.')
  })
})
