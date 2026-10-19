import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $createParagraphNode, $getRoot } from 'lexical'
import { GeneratorType } from '@/app/components/app/configuration/config/automatic/types'
import { $createCurrentBlockNode, CurrentBlockNode } from '../node'

it.each([
  [GeneratorType.prompt, 'current_prompt'],
  [GeneratorType.code, 'current_code'],
] as const)(
  'labels a %s token and consumes its click inside the editor',
  async (generatorType, label) => {
    const user = userEvent.setup()
    const onParentClick = vi.fn()
    render(
      <div role="presentation" onClick={onParentClick}>
        <LexicalComposer
          initialConfig={{
            namespace: 'current-block',
            nodes: [CurrentBlockNode],
            onError: (error) => {
              throw error
            },
            editorState: () => {
              $getRoot().append(
                $createParagraphNode().append($createCurrentBlockNode(generatorType)),
              )
            },
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable aria-label="Prompt" />}
            placeholder={null}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </LexicalComposer>
      </div>,
    )
    await user.click(await screen.findByText(label))
    expect(onParentClick).not.toHaveBeenCalled()
  },
)
