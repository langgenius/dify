import type { HumanInputV2NodeType } from '../types'
import { act } from '@testing-library/react'
import { useNodes, useStoreApi } from 'reactflow'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { createNode } from '../../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../../__tests__/workflow-test-env'
import { createDefaultFormInputByType } from '../../human-input/shared/types'
import useHumanInputV2Config from '../use-config'

const createData = (): HumanInputV2NodeType => ({
  title: 'Migration Approval',
  desc: '',
  type: BlockEnum.HumanInput,
  version: '2',
  form_content: '# Migration review\n\n{{#$output.note#}}\n\n',
  inputs: [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'note',
      default: { type: 'constant', selector: [], value: 'Migration verification' },
    },
    {
      type: InputVarType.select,
      output_variable_name: 'decision',
      option_source: { type: 'constant', selector: [], value: ['Approve', 'Reject'] },
    },
  ],
  user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
  timeout: 1,
  timeout_unit: 'hour',
  recipients_spec: [{ type: 'initiator' }],
  message_template: { subject: 'Migration approval', body: '{{#url#}}' },
  debug_mode: { enabled: false, channels: [] },
})

function setup(data = createData(), readOnly = false) {
  return renderWorkflowCanvasHook(
    () => {
      const node = useNodes<HumanInputV2NodeType>().find((node) => node.id === 'approval')!
      return {
        ...useHumanInputV2Config(node.id, node.data),
        canvas: useStoreApi(),
      }
    },
    {
      nodes: [createNode({ id: 'approval', data })],
      initialStoreState: { canvasReadOnly: readOnly },
      hooksStoreProps: { doSyncWorkflowDraft: async () => null },
    },
  )
}

const saved = (view: ReturnType<typeof setup>) =>
  view.result.current.canvas.getState().getNodes()[0]!.data

it('restores a missing decision once and persists its original options with the body', () => {
  const data = createData()
  const view = setup(data)
  const restored = view.result.current.inputs.form_content
  expect(restored.startsWith(data.form_content)).toBe(true)
  expect(restored.match(/\{\{#\$output\.note#\}\}/g)).toHaveLength(1)
  expect(restored.match(/\{\{#\$output\.decision#\}\}/g)).toHaveLength(1)
  act(() => view.result.current.handleFormContentChange(restored))
  view.rerender()
  expect(saved(view)).toMatchObject({ ...data, form_content: restored })
  expect(view.result.current.inputs.form_content).toBe(restored)
})

it('preserves restored fields when another V2 setting is saved', () => {
  const view = setup()
  const restored = view.result.current.inputs.form_content
  act(() => view.result.current.handleRecipientsChange([{ type: 'all_workspace_contacts' }]))
  expect(saved(view)).toMatchObject({
    form_content: restored,
    inputs: createData().inputs,
    recipients_spec: [{ type: 'all_workspace_contacts' }],
  })
})

it('does not restore a field again after explicit removal', () => {
  const view = setup()
  const note = view.result.current.inputs.inputs[0]
  act(() => view.result.current.handleFormInputItemRemove('decision'))
  view.rerender()
  expect(saved(view).form_content).not.toContain('{{#$output.decision#}}')
  expect(saved(view).inputs).toEqual([note])
  expect(view.result.current.inputs.form_content).toBe(saved(view).form_content)
})

it('shows restored fields on a readonly canvas without saving the repair', () => {
  const data = createData()
  const view = setup(data, true)
  expect(view.result.current.inputs.form_content).toContain('{{#$output.decision#}}')
  act(() => view.result.current.handleFormContentChange(view.result.current.inputs.form_content))
  expect(saved(view)).toMatchObject(data)
})

it.each([
  InputVarType.paragraph,
  InputVarType.select,
  InputVarType.singleFile,
  InputVarType.multiFiles,
])('restores an unreferenced %s field with its configured type and name', (type) => {
  const field = createDefaultFormInputByType(type, 'ReviewNote')
  const view = setup({
    ...createData(),
    inputs: [field],
    form_content: 'Please review this request.',
  })
  expect(view.result.current.inputs.form_content).toBe(
    'Please review this request.\n\n{{#$output.ReviewNote#}}',
  )
  expect(view.result.current.inputs.inputs).toEqual([field])
})

it('preserves the exact body when all configured fields are present', () => {
  const data = createData()
  data.form_content += '\nDecision:\n{{#$output.decision#}}\n\n'
  const view = setup(data)
  expect(view.result.current.inputs.form_content).toBe(data.form_content)
  expect(saved(view)).toMatchObject(data)
})

it('keeps editor deletion and undo consistent with persisted field definitions', () => {
  const view = setup()
  const restored = view.result.current.inputs
  const withoutDecision = restored.form_content.replace('{{#$output.decision#}}', '')
  act(() => view.result.current.handleFormContentChange(withoutDecision))
  expect(saved(view)).toMatchObject({ inputs: [restored.inputs[0]], form_content: withoutDecision })
  expect(view.result.current.inputs.form_content).toBe(withoutDecision)
  act(() => view.result.current.handleFormContentChange(restored.form_content))
  expect(saved(view)).toMatchObject({
    inputs: restored.inputs,
    form_content: restored.form_content,
  })
})

it('does not revive a deleted field when a retained editor callback saves an old field list', () => {
  const view = setup()
  const restored = view.result.current.inputs
  const retainedHandler = view.result.current.handleFormInputsChange
  const deletedBody = restored.form_content.replace('{{#$output.decision#}}', '')
  act(() => view.result.current.handleFormContentChange(deletedBody))
  const editedNote = {
    ...restored.inputs[0]!,
    default: { type: 'constant' as const, selector: [], value: 'Edited note' },
  }
  act(() => retainedHandler([editedNote, restored.inputs[1]!]))
  expect(saved(view)).toMatchObject({ inputs: [editedNote], form_content: deletedBody })
})

it('keeps a newly inserted field after the editor persists its token', () => {
  const view = setup()
  const existing = view.result.current.inputs
  const added = createDefaultFormInputByType(InputVarType.paragraph, 'ReviewNote')
  const body = `${existing.form_content}\n{{#$output.ReviewNote#}}`
  act(() => view.result.current.handleFormContentChange(body))
  act(() => view.result.current.handleFormInputsChange([...existing.inputs, added]))
  expect(saved(view)).toMatchObject({ inputs: [...existing.inputs, added], form_content: body })
})
