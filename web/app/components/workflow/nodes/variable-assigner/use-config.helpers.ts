import type { Var } from '../../types'
import type { VarGroupItem, VariableAssignerNodeType } from './types'
import { produce } from 'immer'
import { v4 as uuid4 } from 'uuid'
import { VarType } from '../../types'

export const filterVarByType = (varType: VarType) => {
  return (variable: Var) => {
    if (varType === VarType.any || variable.type === VarType.any)
      return true

    return variable.type === varType
  }
}

export const updateRootVarGroupItem = (
  inputs: VariableAssignerNodeType,
  payload: VarGroupItem,
) => ({
  ...inputs,
  ...payload,
})

export const updateNestedVarGroupItem = (
  inputs: VariableAssignerNodeType,
  groupId: string,
  payload: VarGroupItem,
) => produce(inputs, (draft) => {
  if (!draft.advanced_settings)
    return

  const index = draft.advanced_settings.groups.findIndex(item => item.groupId === groupId)
  if (index < 0)
    return

  draft.advanced_settings.groups[index] = {
    ...draft.advanced_settings.groups[index]!,
    ...payload,
  }
})

export const removeGroupByIndex = (
  inputs: VariableAssignerNodeType,
  index: number,
) => produce(inputs, (draft) => {
  if (!draft.advanced_settings)
    return
  if (index < 0 || index >= draft.advanced_settings.groups.length)
    return

  draft.advanced_settings.groups.splice(index, 1)
})

export const toggleGroupEnabled = ({
  inputs,
  enabled,
}: {
  inputs: VariableAssignerNodeType
  enabled: boolean
}) => produce(inputs, (draft) => {
  if (!draft.advanced_settings)
    draft.advanced_settings = { group_enabled: false, groups: [] }

  if (enabled) {
    if (draft.advanced_settings.groups.length === 0) {
      draft.advanced_settings.groups = [{
        output_type: draft.output_type,
        variables: draft.variables,
        group_name: 'Group1',
        groupId: uuid4(),
      }]
    }
  }
  else if (draft.advanced_settings.groups.length > 0) {
    draft.output_type = draft.advanced_settings.groups[0]!.output_type
    draft.variables = draft.advanced_settings.groups[0]!.variables
  }

  draft.advanced_settings.group_enabled = enabled
})

export const addGroup = (inputs: VariableAssignerNodeType) => {
  let maxInGroupName = 1
  const groups = inputs.advanced_settings?.groups ?? []
  groups.forEach((item) => {
    const match = /(\d+)$/.exec(item.group_name)
    if (match) {
      const num = Number.parseInt(match[1]!, 10)
      if (num > maxInGroupName)
        maxInGroupName = num
    }
  })

  return produce(inputs, (draft) => {
    if (!draft.advanced_settings)
      draft.advanced_settings = { group_enabled: false, groups: [] }

    draft.advanced_settings.groups.push({
      output_type: VarType.any,
      variables: [],
      group_name: `Group${maxInGroupName + 1}`,
      groupId: uuid4(),
    })
  })
}

export const renameGroup = (
  inputs: VariableAssignerNodeType,
  groupId: string,
  name: string,
) => produce(inputs, (draft) => {
  if (!draft.advanced_settings)
    return

  const index = draft.advanced_settings.groups.findIndex(item => item.groupId === groupId)
  if (index < 0)
    return

  draft.advanced_settings.groups[index]!.group_name = name
})
