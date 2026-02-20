import type { EditorState } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $getRoot } from 'lexical'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import Placeholder from './placeholder'

const config = {
  namespace: 'placeholder-test',
  theme: {},
  nodes: [CustomTextNode],
  onError: (error: Error) => {
    throw error
  },
}

describe('MixedVariable Placeholder', () => {
  it('should render helper text and insert variable action', () => {
    render(
      <LexicalComposer initialConfig={config}>
        <Placeholder />
      </LexicalComposer>,
    )

    expect(screen.getByText('Type or press')).toBeInTheDocument()
    expect(screen.getByText('insert variable')).toBeInTheDocument()
    expect(screen.getByText('String')).toBeInTheDocument()
  })

  it('should render shortcut symbol for variable insertion', () => {
    render(
      <LexicalComposer initialConfig={config}>
        <Placeholder />
      </LexicalComposer>,
    )

    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('should insert text and keep editor content available after click', async () => {
    const user = userEvent.setup()
    let editorText = ''
    const handleChange = (editorState: EditorState) => {
      editorState.read(() => {
        editorText = $getRoot().getTextContent()
      })
    }

    render(
      <LexicalComposer initialConfig={config}>
        <OnChangePlugin onChange={handleChange} />
        <Placeholder />
      </LexicalComposer>,
    )

    await user.click(screen.getByText('insert variable'))

    expect(editorText).toContain('/')
  })

  it('should handle container click without breaking the helper UI', async () => {
    const user = userEvent.setup()
    render(
      <LexicalComposer initialConfig={config}>
        <Placeholder />
      </LexicalComposer>,
    )

    await user.click(screen.getByText('Type or press'))
    expect(screen.getByText('insert variable')).toBeInTheDocument()
  })
})
