import { useCallback } from 'react'
import produce from 'immer'
import { VarType } from '../../types'
import type { VarGroupItem, VariableAssignerNodeType } from './types'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: VariableAssignerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<VariableAssignerNodeType>(id, payload)
  const isEnableGroup = !!inputs.advanced_settings?.group_enabled

  // Not Enable Group
  const handleListOrTypeChange = useCallback((payload: VarGroupItem) => {
    setInputs({
      ...inputs,
      ...payload,
    })
  }, [inputs, setInputs])

  const handleListOrTypeChangeInGroup = useCallback((index: number) => {
    return (payload: VarGroupItem) => {
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.groups[index] = {
          ...draft.advanced_settings.groups[index],
          ...payload,
        }
      })
      setInputs(newInputs)
    }
  }, [inputs, setInputs])

  const handleGroupRemoved = useCallback((index: number) => {
    return () => {
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.groups.splice(index, 1)
      })
      setInputs(newInputs)
    }
  }, [inputs, setInputs])

  const handleGroupEnabledChange = useCallback((enabled: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.advanced_settings)
        draft.advanced_settings = { group_enabled: false, groups: [] }
      if (enabled) {
        if (draft.advanced_settings.groups.length === 0) {
          draft.advanced_settings.groups = [{
            output_type: draft.output_type,
            variables: draft.variables,
            group_name: 'Group1',
          }]
        }
      }
      else {
        if (draft.advanced_settings.groups.length > 0) {
          draft.output_type = draft.advanced_settings.groups[0].output_type
          draft.variables = draft.advanced_settings.groups[0].variables
        }
      }
      draft.advanced_settings.group_enabled = enabled
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleAddGroup = useCallback(() => {
    let maxInGroupName = 1
    inputs.advanced_settings.groups.forEach((item) => {
      const match = item.group_name.match(/(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxInGroupName)
          maxInGroupName = num
      }
    })
    const newInputs = produce(inputs, (draft) => {
      draft.advanced_settings.groups.push({
        output_type: VarType.any,
        variables: [],
        group_name: `Group${maxInGroupName + 1}`,
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleVarGroupItemChange = useCallback((index: number) => {
    return (name: string) => {
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.groups[index].group_name = name
      })
      setInputs(newInputs)
    }
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    handleListOrTypeChange,
    isEnableGroup,
    handleGroupEnabledChange,
    handleAddGroup,
    handleListOrTypeChangeInGroup,
    handleGroupRemoved,
    handleVarGroupItemChange,
  }
}

export default useConfig
