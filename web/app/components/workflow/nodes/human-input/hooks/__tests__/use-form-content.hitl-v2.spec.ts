import type { HumanInputV2NodeType } from '../../../human-input-v2/types'
import { act } from '@testing-library/react'
import { useNodes, useStoreApi } from 'reactflow'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { createNode } from '../../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../../__tests__/workflow-test-env'
import useHumanInputV2Config from '../../../human-input-v2/use-config'
import useHumanInputFormContent from '../../shared/use-form-content'

it.each(['field', 'content'] as const)(
  'preserves the latest V2 configuration when a retained editor saves %s',
  (change) => {
    const data: HumanInputV2NodeType = {
      title: 'Human Input V2',
      desc: '',
      type: BlockEnum.HumanInput,
      version: '2',
      form_content: 'Hello {{#$output.old_name#}}',
      inputs: [
        {
          type: InputVarType.paragraph,
          output_variable_name: 'old_name',
          default: { selector: [], type: 'constant', value: '' },
        },
      ],
      user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
      timeout: 1,
      timeout_unit: 'hour',
      recipients_spec: [{ type: 'initiator' }],
      message_template: { subject: 'Approval', body: 'Please review' },
      debug_mode: { enabled: false, channels: [] },
    }
    const { result } = renderWorkflowCanvasHook(
      () => {
        const node = useNodes<HumanInputV2NodeType>()[0]!
        return {
          editor: useHumanInputFormContent(node.id, node.data),
          config: useHumanInputV2Config(node.id, node.data),
          canvas: useStoreApi(),
        }
      },
      {
        nodes: [createNode({ id: 'human-input-node', data })],
        hooksStoreProps: { doSyncWorkflowDraft: async () => null },
      },
    )
    // Existing Lexical blocks retain these public callbacks while the panel changes.
    const retainedEditor = result.current.editor
    act(() =>
      result.current.config.handleRecipientsChange([
        { type: 'initiator' },
        { type: 'contact', contact_id: 'contact-1' },
      ]),
    )
    act(() =>
      result.current.config.handleUserActionChange(0, {
        id: 'approve',
        title: 'Approve updated',
        button_style: 'primary',
      }),
    )
    act(() => result.current.config.handleTimeoutChange({ timeout: 2, unit: 'hour' }))
    act(() =>
      result.current.config.handleMessageTemplateChange({
        subject: 'Updated approval',
        body: 'Updated message',
      }),
    )
    act(() => result.current.config.handleFormContentChange('Updated body {{#$output.old_name#}}'))
    const nextInputs = [
      {
        ...data.inputs[0]!,
        default: { selector: [], type: 'constant' as const, value: 'Updated default' },
      },
    ]
    act(() => {
      if (change === 'field') retainedEditor.handleFormInputsChange(nextInputs)
      else retainedEditor.handleFormContentChange('Edited body {{#$output.old_name#}}')
    })
    expect(result.current.canvas.getState().getNodes()[0]!.data).toMatchObject({
      ...data,
      recipients_spec: [{ type: 'initiator' }, { type: 'contact', contact_id: 'contact-1' }],
      user_actions: [{ id: 'approve', title: 'Approve updated', button_style: 'primary' }],
      timeout: 2,
      message_template: { subject: 'Updated approval', body: 'Updated message' },
      form_content:
        change === 'field'
          ? 'Updated body {{#$output.old_name#}}'
          : 'Edited body {{#$output.old_name#}}',
      inputs: change === 'field' ? nextInputs : data.inputs,
    })
  },
)
