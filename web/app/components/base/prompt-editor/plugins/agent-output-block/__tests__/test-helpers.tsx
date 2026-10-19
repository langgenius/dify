import type { DeclaredOutputConfig } from '@dify/contracts/api/console/apps/types.gen'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createAgentOutputBlockNode, AgentOutputBlockNode } from '../node'

export type OutputEditorProps = {
  isEditing?: boolean
  selectNameOnEdit?: boolean
  openTypeSelectOnEdit?: boolean
  onChange?: Parameters<typeof $createAgentOutputBlockNode>[4]
  onEdit?: Parameters<typeof $createAgentOutputBlockNode>[5]
  declaredOutputs?: DeclaredOutputConfig[]
}
export function OutputEditor({
  isEditing = true,
  selectNameOnEdit = isEditing,
  openTypeSelectOnEdit = false,
  onChange,
  onEdit,
  declaredOutputs = [{ name: 'output', type: 'string', required: false }],
}: OutputEditorProps) {
  return (
    <>
      <LexicalComposer
        initialConfig={{
          namespace: 'agent-output-component',
          nodes: [AgentOutputBlockNode],
          onError: (error) => {
            throw error
          },
          editorState: () => {
            $getRoot().append(
              $createParagraphNode().append(
                $createTextNode('Generate '),
                $createAgentOutputBlockNode(
                  'output',
                  'string',
                  isEditing,
                  declaredOutputs,
                  onChange,
                  onEdit,
                  selectNameOnEdit,
                  openTypeSelectOnEdit,
                ),
                $createTextNode(' after'),
              ),
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
      <button type="button">Outside editor</button>
    </>
  )
}
