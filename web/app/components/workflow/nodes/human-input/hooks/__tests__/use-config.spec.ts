import type { HumanInputNodeType, ParagraphFormInput } from '../../types'
import { act } from '@testing-library/react'
import { useNodes, useReactFlow } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import useConfig from '../use-config'

const formInput = (name: string): ParagraphFormInput => ({
  type: InputVarType.paragraph,
  output_variable_name: name,
  default: { selector: [], type: 'constant', value: '' },
})
const createPayload = (overrides: Partial<HumanInputNodeType> = {}): HumanInputNodeType => ({
  title: 'Approval',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [{ id: 'webapp', type: 'webapp', enabled: true }],
  form_content: 'Hello {{#$output.name#}}',
  inputs: [formInput('name')],
  user_actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
  timeout: 3,
  timeout_unit: 'day',
  ...overrides,
})
const setup = (payload = createPayload()) =>
  renderWorkflowFlowHook(
    () => {
      const nodes = useNodes<HumanInputNodeType>()
      return {
        config: useConfig(
          'approval',
          nodes.find((node) => node.id === 'approval')?.data ?? payload,
        ),
        flow: useReactFlow(),
      }
    },
    {
      nodes: [
        createNode({ id: 'approval', data: payload }),
        createNode({
          id: 'consumer',
          data: {
            type: BlockEnum.Code,
            variables: [{ variable: 'answer', value_selector: ['approval', 'name'] }],
            code_language: 'python3',
            code: '',
            outputs: {},
          },
        }),
        createNode({
          id: 'other',
          data: {
            type: BlockEnum.Code,
            variables: [],
            code_language: 'python3',
            code: '',
            outputs: {},
          },
        }),
      ],
      edges: [
        createEdge({
          id: 'approved',
          source: 'approval',
          target: 'consumer',
          sourceHandle: 'approve',
        }),
        createEdge({ id: 'timeout', source: 'approval', target: 'other', sourceHandle: 'timeout' }),
      ],
    },
  )

it('persists delivery, timeout and content changes without discarding previous edits', () => {
  const { result } = setup()
  act(() =>
    result.current.config.handleDeliveryMethodChange([
      { id: 'webapp', type: 'webapp', enabled: false },
    ]),
  )
  act(() => result.current.config.handleTimeoutChange({ timeout: 12, unit: 'hour' }))
  act(() => result.current.config.handleFormContentChange('Updated body'))
  expect(result.current.flow.getNode('approval')?.data).toEqual(
    expect.objectContaining({
      delivery_methods: [{ id: 'webapp', type: 'webapp', enabled: false }],
      timeout: 12,
      timeout_unit: 'hour',
      form_content: 'Updated body',
    }),
  )
})

it('renames action handles on connected edges and deletes only the removed action branch', () => {
  const { result } = setup()
  act(() =>
    result.current.config.handleUserActionAdd({
      id: 'reject',
      title: 'Reject',
      button_style: 'default',
    }),
  )
  act(() =>
    result.current.config.handleUserActionChange(0, {
      id: 'approved',
      title: 'Approve',
      button_style: 'primary',
    }),
  )
  expect(
    result.current.flow.getEdges().find((edge) => edge.target === 'consumer')?.sourceHandle,
  ).toBe('approved')
  act(() => result.current.config.handleUserActionDelete('approved'))
  expect(result.current.config.inputs.user_actions.map((action) => action.id)).toEqual(['reject'])
  expect(result.current.flow.getEdges().map((edge) => edge.target)).toEqual(['other'])
})

it('renames form placeholders and downstream references through the real graph', () => {
  const { result } = setup()
  act(() => result.current.config.handleFormInputItemRename(formInput('renamed'), 'name'))
  expect(result.current.config.inputs.form_content).toBe('Hello {{#$output.renamed#}}')
  expect(result.current.config.inputs.inputs).toEqual([formInput('renamed')])
  expect(result.current.flow.getNode('consumer')?.data.variables).toEqual([
    { variable: 'answer', value_selector: ['approval', 'renamed'] },
  ])
  act(() => result.current.config.handleFormInputItemRemove('renamed'))
  expect(result.current.config.inputs.form_content).toBe('Hello ')
  expect(result.current.config.inputs.inputs).toEqual([])
})

it('rejects a duplicate output name without changing placeholders or downstream references', () => {
  const payload = createPayload({ inputs: [formInput('name'), formInput('existing')] })
  const { result } = setup(payload)
  act(() => result.current.config.handleFormInputItemRename(formInput('existing'), 'name'))
  expect(result.current.config.inputs).toEqual(expect.objectContaining(payload))
  expect(result.current.flow.getNode('consumer')?.data.variables).toEqual([
    { variable: 'answer', value_selector: ['approval', 'name'] },
  ])
})

it('replaces the form input list through the configuration owner', () => {
  const { result } = setup()
  act(() => result.current.config.handleFormInputsChange([formInput('replacement')]))
  expect(result.current.config.inputs.inputs).toEqual([formInput('replacement')])
  expect(result.current.config.inputs.form_content).toBe('Hello {{#$output.name#}}')
})
