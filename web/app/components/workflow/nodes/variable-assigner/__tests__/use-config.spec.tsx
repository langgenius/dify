import type { VariableAssignerNodeType } from '../types'
import { act, waitFor } from '@testing-library/react'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import useConfig from '../use-config'

// Inspector persistence is outside graph editing; its CRUD contract has separate coverage.
const { deleteNodeInspectorVars, renameInspectVarName } = vi.hoisted(() => ({
  deleteNodeInspectorVars: vi.fn(),
  renameInspectVarName: vi.fn(),
}))
vi.mock('../../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({ deleteNodeInspectorVars, renameInspectVarName }),
}))
const createPayload = (
  overrides: Partial<VariableAssignerNodeType> = {},
): VariableAssignerNodeType => ({
  title: 'Variable Assigner',
  desc: '',
  type: BlockEnum.VariableAssigner,
  output_type: VarType.string,
  variables: [['source-node', 'initialVar']],
  advanced_settings: {
    group_enabled: true,
    groups: [
      {
        groupId: 'group-1',
        group_name: 'Group1',
        output_type: VarType.string,
        variables: [['source-node', 'initialVar']],
      },
      {
        groupId: 'group-2',
        group_name: 'Group2',
        output_type: VarType.number,
        variables: [],
      },
    ],
  },
  ...overrides,
})

const createPayloadWithoutAdvancedSettings = (): VariableAssignerNodeType => {
  const payload = createPayload() as Omit<VariableAssignerNodeType, 'advanced_settings'> & {
    advanced_settings?: VariableAssignerNodeType['advanced_settings']
  }
  delete payload.advanced_settings

  return payload as VariableAssignerNodeType
}

const renderWithConsumer = (groupName = 'Group2') => {
  const payload = createPayload()
  return renderNodeConfig(useConfig, payload, {
    nodes: [
      createNode({ id: 'node', data: payload }),
      createNode({
        id: 'consumer',
        data: {
          type: BlockEnum.TemplateTransform,
          template: '{{ output }}',
          variables: [{ variable: 'output', value_selector: ['node', groupName, 'output'] }],
        },
      }),
    ],
    edges: [createEdge({ source: 'node', target: 'consumer' })],
  })
}
describe('variable-assigner/use-config', () => {
  it('preserves root bindings while editing groups and adding/removing other groups', () => {
    const { result } = renderNodeConfig(useConfig, createPayload())
    act(() =>
      result.current.config.handleListOrTypeChange({
        output_type: VarType.number,
        variables: [['source-node', 'changed']],
      }),
    )
    act(() =>
      result.current.config.handleListOrTypeChangeInGroup('group-1')({
        output_type: VarType.boolean,
        variables: [['source-node', 'groupVar']],
      }),
    )
    act(() => result.current.config.handleAddGroup())
    const added = result.current.config.inputs.advanced_settings!.groups[2]!
    act(() => result.current.config.handleGroupRemoved('group-2')())
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      output_type: VarType.number,
      variables: [['source-node', 'changed']],
      advanced_settings: {
        groups: [
          expect.objectContaining({
            groupId: 'group-1',
            output_type: VarType.boolean,
            variables: [['source-node', 'groupVar']],
          }),
          added,
        ],
      },
    })
    expect(deleteNodeInspectorVars).toHaveBeenCalledWith('node')
  })
  it('renames the group and its downstream reference, then persists the inspector name', async () => {
    const { result } = renderWithConsumer('Group1')
    act(() => result.current.config.handleVarGroupNameChange('group-1')('Renamed'))
    expect(result.current.flow.getNode('node')?.data.advanced_settings.groups[0].group_name).toBe(
      'Renamed',
    )
    expect(result.current.flow.getNode('consumer')?.data.variables[0].value_selector).toEqual([
      'node',
      'Renamed',
      'output',
    ])
    await waitFor(() =>
      expect(renameInspectVarName).toHaveBeenCalledWith('node', 'Group1', 'Renamed'),
    )
  })
  it.each(['remove', 'disable'] as const)(
    'requires confirmation to %s a referenced group',
    (action) => {
      const { result } = renderWithConsumer()
      act(() =>
        action === 'remove'
          ? result.current.config.handleGroupRemoved('group-2')()
          : result.current.config.handleGroupEnabledChange(false),
      )
      expect(result.current.config.isShowRemoveVarConfirm).toBe(true)
      expect(result.current.flow.getNode('node')?.data.advanced_settings.groups).toHaveLength(2)
      expect(result.current.flow.getNode('consumer')?.data.variables[0].value_selector).toEqual([
        'node',
        'Group2',
        'output',
      ])
      act(() => result.current.config.onRemoveVarConfirm())
      expect(result.current.config.isShowRemoveVarConfirm).toBe(false)
      expect(result.current.flow.getNode('consumer')?.data.variables[0].value_selector).toEqual([])
      if (action === 'remove')
        expect(result.current.flow.getNode('node')?.data.advanced_settings.groups).toEqual([
          expect.objectContaining({ groupId: 'group-1' }),
        ])
      else
        expect(result.current.flow.getNode('node')?.data.advanced_settings.group_enabled).toBe(
          false,
        )
    },
  )
  it.each(['empty', 'legacy'] as const)(
    'enables groups for %s settings and restores root bindings when disabled',
    (variant) => {
      const payload =
        variant === 'legacy'
          ? createPayloadWithoutAdvancedSettings()
          : createPayload({ advanced_settings: { group_enabled: false, groups: [] } })
      const { result } = renderNodeConfig(useConfig, payload)
      act(() => result.current.config.handleGroupEnabledChange(true))
      expect(result.current.flow.getNode('node')?.data.advanced_settings).toMatchObject({
        group_enabled: true,
        groups: [expect.objectContaining({ group_name: 'Group1', variables: payload.variables })],
      })
      act(() => result.current.config.handleGroupEnabledChange(false))
      expect(result.current.flow.getNode('node')?.data).toMatchObject({
        advanced_settings: { group_enabled: false },
        variables: payload.variables,
        output_type: payload.output_type,
      })
    },
  )
})
