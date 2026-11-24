import type { FormInputItem } from '../../human-input/shared/types'
import { act, waitFor } from '@testing-library/react'
import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical'
import {
  readEditorStateValue,
  renderLexicalEditor,
  waitForEditorReady,
} from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import HITLInputReplacementBlock from '@/app/components/base/prompt-editor/plugins/hitl-input-block/hitl-input-block-replacement-block'
import { HITLInputNode } from '@/app/components/base/prompt-editor/plugins/hitl-input-block/node'
import { InputVarType } from '@/app/components/workflow/types'

describe('Human Input V2 restored form controls', () => {
  it('renders both the existing control and the restored decision control in separate paragraphs', async () => {
    const formInputs: FormInputItem[] = [
      {
        type: InputVarType.paragraph,
        output_variable_name: 'name',
        default: { type: 'constant', selector: [], value: 'Reviewer' },
      },
      {
        type: InputVarType.select,
        output_variable_name: 'decision',
        option_source: { type: 'constant', selector: [], value: ['Approve', 'Reject'] },
      },
    ]
    const { getEditor } = renderLexicalEditor({
      namespace: 'human-input-v2-restored-controls',
      nodes: [CustomTextNode, HITLInputNode],
      children: (
        <HITLInputReplacementBlock
          nodeId="approval"
          formInputs={formInputs}
          onFormInputsChange={vi.fn()}
          onFormInputItemRename={vi.fn()}
          onFormInputItemRemove={vi.fn()}
        />
      ),
    })
    const editor = await waitForEditorReady(getEditor)

    act(() => {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        for (const field of formInputs) {
          root.append(
            $createParagraphNode().append(
              new CustomTextNode(`{{#$output.${field.output_variable_name}#}}`),
            ),
          )
        }
      })
    })

    await waitFor(() => {
      expect(
        readEditorStateValue(editor, () =>
          $nodesOfType(HITLInputNode).map((node) => node.getVariableName()),
        ),
      ).toEqual(['name', 'decision'])
    })
  })
})
