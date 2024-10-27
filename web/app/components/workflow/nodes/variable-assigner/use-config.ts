import { useCallback, useState } from 'react'
import produce from 'immer'
import { useBoolean } from 'ahooks'
import { v4 as uuid4 } from 'uuid'
import type { ValueSelector, Var } from '../../types'
import { VarType } from '../../types'
import type { VarGroupItem, VariableAssignerNodeType } from './types'
import { useGetAvailableVars } from './hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'

import {
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'

const useConfig = (id: string, payload: VariableAssignerNodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()

  const { inputs, setInputs } = useNodeCrud<VariableAssignerNodeType>(id, payload)
  const isEnableGroup = !!inputs.advanced_settings?.group_enabled

  // Not Enable Group
  const handleListOrTypeChange = useCallback((payload: VarGroupItem) => {
    setInputs({
      ...inputs,
      ...payload,
    })
  }, [inputs, setInputs])

  const handleListOrTypeChangeInGroup = useCallback((groupId: string) => {
    return (payload: VarGroupItem) => {
      const index = inputs.advanced_settings.groups.findIndex(item => item.groupId === groupId)
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.groups[index] = {
          ...draft.advanced_settings.groups[index],
          ...payload,
        }
      })
      setInputs(newInputs)
    }
  }, [inputs, setInputs])

  const getAvailableVars = useGetAvailableVars()
  const filterVar = (varType: VarType) => {
    return (v: Var) => {
      if (varType === VarType.any)
        return true
      if (v.type === VarType.any)
        return true
      return v.type === varType
    }
  }

  const [isShowRemoveVarConfirm, {
    setTrue: showRemoveVarConfirm,
    setFalse: hideRemoveVarConfirm,
  }] = useBoolean(false)

  const [removedVars, setRemovedVars] = useState<ValueSelector[]>([])
  const [removeType, setRemoveType] = useState<'group' | 'enableChanged'>('group')
  const [removedGroupIndex, setRemovedGroupIndex] = useState<number>(-1)
  const handleGroupRemoved = useCallback((groupId: string) => {
    return () => {
      const index = inputs.advanced_settings.groups.findIndex(item => item.groupId === groupId)
      if (isVarUsedInNodes([id, inputs.advanced_settings.groups[index].group_name, 'output'])) {
        showRemoveVarConfirm()
        setRemovedVars([[id, inputs.advanced_settings.groups[index].group_name, 'output']])
        setRemoveType('group')
        setRemovedGroupIndex(index)
        return
      }
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.groups.splice(index, 1)
      })
      setInputs(newInputs)
    }
  }, [id, inputs, isVarUsedInNodes, setInputs, showRemoveVarConfirm])

  const handleGroupEnabledChange = useCallback((enabled: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.advanced_settings)
        draft.advanced_settings = { group_enabled: false, groups: [] }
      if (enabled) {
        if (draft.advanced_settings.groups.length === 0) {
          const DEFAULT_GROUP_NAME = 'Group1'
          draft.advanced_settings.groups = [{
            output_type: draft.output_type,
            variables: draft.variables,
            group_name: DEFAULT_GROUP_NAME,
            groupId: uuid4(),
          }]

          handleOutVarRenameChange(id, [id, 'output'], [id, DEFAULT_GROUP_NAME, 'output'])
        }
      }
      else {
        if (draft.advanced_settings.groups.length > 0) {
          if (draft.advanced_settings.groups.length > 1) {
            const useVars = draft.advanced_settings.groups.filter((item, index) => index > 0 && isVarUsedInNodes([id, item.group_name, 'output']))
            if (useVars.length > 0) {
              showRemoveVarConfirm()
              setRemovedVars(useVars.map(item => [id, item.group_name, 'output']))
              setRemoveType('enableChanged')
              return
            }
          }
          draft.output_type = draft.advanced_settings.groups[0].output_type
          draft.variables = draft.advanced_settings.groups[0].variables
          handleOutVarRenameChange(id, [id, draft.advanced_settings.groups[0].group_name, 'output'], [id, 'output'])
        }
      }
      draft.advanced_settings.group_enabled = enabled
    })
    setInputs(newInputs)
  }, [handleOutVarRenameChange, id, inputs, isVarUsedInNodes, setInputs, showRemoveVarConfirm])

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
        groupId: uuid4(),
      })
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  const handleVarGroupNameChange = useCallback((groupId: string) => {
    return (name: string) => {
      const index = inputs.advanced_settings.groups.findIndex(item => item.groupId === groupId)
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.groups[index].group_name = name
      })
      handleOutVarRenameChange(id, [id, inputs.advanced_settings.groups[index].group_name, 'output'], [id, name, 'output'])
      setInputs(newInputs)
    }
  }, [handleOutVarRenameChange, id, inputs, setInputs])

  const onRemoveVarConfirm = useCallback(() => {
    removedVars.forEach((v) => {
      removeUsedVarInNodes(v)
    })
    hideRemoveVarConfirm()
    if (removeType === 'group') {
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.groups.splice(removedGroupIndex, 1)
      })
      setInputs(newInputs)
    }
    else {
      // removeType === 'enableChanged' to enabled
      const newInputs = produce(inputs, (draft) => {
        draft.advanced_settings.group_enabled = false
        draft.output_type = draft.advanced_settings.groups[0].output_type
        draft.variables = draft.advanced_settings.groups[0].variables
      })
      setInputs(newInputs)
    }
  }, [removedVars, hideRemoveVarConfirm, removeType, removeUsedVarInNodes, inputs, setInputs, removedGroupIndex])

  return {
    readOnly,
    inputs,
    handleListOrTypeChange,
    isEnableGroup,
    handleGroupEnabledChange,
    handleAddGroup,
    handleListOrTypeChangeInGroup,
    handleGroupRemoved,
    handleVarGroupNameChange,
    isShowRemoveVarConfirm,
    hideRemoveVarConfirm,
    onRemoveVarConfirm,
    getAvailableVars,
    filterVar,
  }
}

export default useConfig
