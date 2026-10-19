import type { HumanInputV2NodeType } from '../types'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { createDefaultFormInputByType } from '../../human-input/shared/types'
import useHumanInputV2Config from '../use-config'

const setInputs = vi.hoisted(() => vi.fn<(inputs: HumanInputV2NodeType) => void>())
const readOnly = vi.hoisted(() => ({ value: false }))

vi.mock('reactflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('reactflow')>()),
  useUpdateNodeInternals: () => vi.fn(),
}))
vi.mock('@/app/components/workflow/hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: readOnly.value }),
  useWorkflow: () => ({ handleOutVarRenameChange: vi.fn() }),
}))
vi.mock('@/app/components/workflow/hooks/use-edges-interactions', () => ({
  useEdgesInteractions: () => ({
    handleEdgeDeleteByDeleteBranch: vi.fn(),
    handleEdgeSourceHandleChange: vi.fn(),
  }),
}))
vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  default: (_id: string, inputs: HumanInputV2NodeType) => ({ inputs, setInputs }),
}))

const createNode = (): HumanInputV2NodeType => ({
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

describe('Human Input V2 form configuration', () => {
  beforeEach(() => {
    setInputs.mockClear()
    readOnly.value = false
  })

  it('restores a configured decision field missing from the editor body without replacing its options', () => {
    const node = createNode()
    const { result } = renderHook(() => useHumanInputV2Config('approval', node))

    expect(result.current.inputs.form_content).toContain('{{#$output.decision#}}')
    expect(result.current.inputs.form_content.startsWith(node.form_content)).toBe(true)
    expect(result.current.inputs.form_content.match(/\{\{#\$output\.note#\}\}/g)).toHaveLength(1)
    expect(result.current.inputs.inputs).toEqual(node.inputs)

    act(() => {
      result.current.handleFormContentChange(result.current.inputs.form_content)
    })

    expect(setInputs).toHaveBeenCalledWith({
      ...node,
      form_content: result.current.inputs.form_content,
    })
  })

  it('keeps a restored field exactly once after saving and reloading the node', () => {
    const node = createNode()
    const { result, rerender } = renderHook(
      ({ payload }) => useHumanInputV2Config('approval', payload),
      {
        initialProps: { payload: node },
      },
    )
    const restored = result.current.inputs

    rerender({ payload: restored })
    rerender({ payload: result.current.inputs })

    expect(result.current.inputs.form_content).toBe(restored.form_content)
    expect(result.current.inputs.form_content.match(/\{\{#\$output\.decision#\}\}/g)).toHaveLength(
      1,
    )
    expect(result.current.inputs.inputs).toEqual(node.inputs)
  })

  it('preserves the configured fields when saving another V2 setting', () => {
    const node = createNode()
    const { result } = renderHook(() => useHumanInputV2Config('approval', node))

    act(() => {
      result.current.handleRecipientsChange([{ type: 'all_workspace_contacts' }])
    })

    expect(setInputs).toHaveBeenCalledWith({
      ...result.current.inputs,
      recipients_spec: [{ type: 'all_workspace_contacts' }],
    })
    expect(node.form_content).not.toContain('{{#$output.decision#}}')
  })

  it('does not restore a field again after it is explicitly removed', () => {
    const { result, rerender } = renderHook(
      ({ payload }) => useHumanInputV2Config('approval', payload),
      {
        initialProps: { payload: createNode() },
      },
    )
    const restored = result.current.inputs

    act(() => {
      result.current.handleFormInputItemRemove('decision')
    })

    const removed = setInputs.mock.lastCall?.[0]
    if (!removed) throw new Error('Expected the updated node after removing decision')
    expect(removed.form_content).not.toContain('{{#$output.decision#}}')
    expect(removed.inputs).toEqual([restored.inputs[0]])
    rerender({ payload: removed })
    expect(result.current.inputs.form_content).toBe(removed.form_content)
  })

  it('shows restored fields in readonly mode without saving the repair', () => {
    readOnly.value = true
    const node = createNode()
    const { result } = renderHook(() => useHumanInputV2Config('approval', node))

    expect(result.current.inputs.form_content).toContain('{{#$output.decision#}}')
    expect(setInputs).not.toHaveBeenCalled()

    act(() => {
      result.current.handleFormContentChange(result.current.inputs.form_content)
    })

    expect(setInputs).not.toHaveBeenCalled()
  })

  it.each([
    InputVarType.paragraph,
    InputVarType.select,
    InputVarType.singleFile,
    InputVarType.multiFiles,
  ])('restores an unreferenced %s field while preserving its type and name', (type) => {
    const node = createNode()
    const field = createDefaultFormInputByType(type, 'ReviewNote')
    node.inputs = [field]
    node.form_content = 'Please review this request.'
    const { result } = renderHook(() => useHumanInputV2Config('approval', node))

    expect(result.current.inputs.form_content).toBe(
      'Please review this request.\n\n{{#$output.ReviewNote#}}',
    )
    expect(result.current.inputs.inputs).toEqual([field])
  })

  it('preserves the exact body when every configured field is already present', () => {
    const node = createNode()
    node.form_content += '\nDecision:\n{{#$output.decision#}}\n\n'
    const { result } = renderHook(() => useHumanInputV2Config('approval', node))

    expect(result.current.inputs.form_content).toBe(node.form_content)
    expect(setInputs).not.toHaveBeenCalled()
  })

  it('keeps keyboard deletion and undo consistent with the field definitions', () => {
    const { result, rerender } = renderHook(
      ({ payload }) => useHumanInputV2Config('approval', payload),
      { initialProps: { payload: createNode() } },
    )
    const restored = result.current.inputs
    const withoutDecision = restored.form_content.replace('{{#$output.decision#}}', '')

    act(() => {
      result.current.handleFormContentChange(withoutDecision)
    })

    const deleted = setInputs.mock.lastCall?.[0]
    if (!deleted) throw new Error('Expected the keyboard deletion to update the node')
    expect(deleted.inputs).toEqual([restored.inputs[0]])
    rerender({ payload: deleted })
    expect(result.current.inputs.form_content).toBe(withoutDecision)

    act(() => {
      result.current.handleFormContentChange(restored.form_content)
    })

    const undone = setInputs.mock.lastCall?.[0]
    if (!undone) throw new Error('Expected undo to restore the node')
    expect(undone.inputs).toEqual(restored.inputs)
    rerender({ payload: undone })
    expect(result.current.inputs.form_content).toBe(restored.form_content)
  })

  it('does not revive a deleted field when an existing editor block saves an old field list', () => {
    const { result, rerender } = renderHook(
      ({ payload }) => useHumanInputV2Config('approval', payload),
      { initialProps: { payload: createNode() } },
    )
    const restored = result.current.inputs
    const retainedHandler = result.current.handleFormInputsChange

    act(() => {
      result.current.handleFormContentChange(
        restored.form_content.replace('{{#$output.decision#}}', ''),
      )
    })
    const deleted = setInputs.mock.lastCall?.[0]
    if (!deleted) throw new Error('Expected the field deletion to update the node')
    rerender({ payload: deleted })

    const editedNote = {
      ...restored.inputs[0]!,
      default: { type: 'constant' as const, selector: [], value: 'Edited note' },
    }
    act(() => {
      retainedHandler([editedNote, restored.inputs[1]!])
    })

    expect(setInputs.mock.lastCall?.[0].inputs).toEqual([editedNote])
    expect(setInputs.mock.lastCall?.[0].form_content).toBe(deleted.form_content)
  })

  it('keeps a newly inserted field after the editor persists its body token', () => {
    const { result, rerender } = renderHook(
      ({ payload }) => useHumanInputV2Config('approval', payload),
      { initialProps: { payload: createNode() } },
    )
    const existing = result.current.inputs
    const added = createDefaultFormInputByType(InputVarType.paragraph, 'ReviewNote')
    act(() => {
      result.current.handleFormContentChange(`${existing.form_content}\n{{#$output.ReviewNote#}}`)
    })
    const bodyUpdated = setInputs.mock.lastCall?.[0]
    if (!bodyUpdated) throw new Error('Expected the inserted token to update the body')
    rerender({ payload: bodyUpdated })
    act(() => {
      result.current.handleFormInputsChange([...existing.inputs, added])
    })
    expect(setInputs.mock.lastCall?.[0].inputs).toEqual([...existing.inputs, added])
    expect(setInputs.mock.lastCall?.[0].form_content).toContain('{{#$output.ReviewNote#}}')
  })
})
