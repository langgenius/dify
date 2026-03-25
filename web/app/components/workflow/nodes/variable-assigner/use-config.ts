import type { ValueSelector } from '../../types'
import type { VarGroupItem, VariableAssignerNodeType } from './types'
import { useBoolean, useDebounceFn } from 'ahooks'
import { useCallback, useRef, useState } from 'react'
import {
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import useInspectVarsCrud from '../../hooks/use-inspect-vars-crud'

import { useGetAvailableVars } from './hooks'
import {
  addGroup,
  filterVarByType,
  removeGroupByIndex,
  renameGroup,
  toggleGroupEnabled,
  updateNestedVarGroupItem,
  updateRootVarGroupItem,
} from './use-config.helpers'

const useConfig = (id: string, payload: VariableAssignerNodeType) => {
  const {
    deleteNodeInspectorVars,
    renameInspectVarName,
  } = useInspectVarsCrud()
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { handleOutVarRenameChange, isVarUsedInNodes, removeUsedVarInNodes } = useWorkflow()

  const { inputs, setInputs } = useNodeCrud<VariableAssignerNodeType>(id, payload)
  const isEnableGroup = !!inputs.advanced_settings?.group_enabled

  // Not Enable Group
  const handleListOrTypeChange = useCallback((payload: VarGroupItem) => {
    setInputs(updateRootVarGroupItem(inputs, payload))
  }, [inputs, setInputs])

  const handleListOrTypeChangeInGroup = useCallback((groupId: string) => {
    return (payload: VarGroupItem) => {
      setInputs(updateNestedVarGroupItem(inputs, groupId, payload))
    }
  }, [inputs, setInputs])

  const getAvailableVars = useGetAvailableVars()

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
      setInputs(removeGroupByIndex(inputs, index))
    }
  }, [id, inputs, isVarUsedInNodes, setInputs, showRemoveVarConfirm])

  const handleGroupEnabledChange = useCallback((enabled: boolean) => {
    if (enabled && inputs.advanced_settings.groups.length === 0) {
      handleOutVarRenameChange(id, [id, 'output'], [id, 'Group1', 'output'])
    }

    if (!enabled && inputs.advanced_settings.groups.length > 0) {
      if (inputs.advanced_settings.groups.length > 1) {
        const useVars = inputs.advanced_settings.groups.filter((item, index) => index > 0 && isVarUsedInNodes([id, item.group_name, 'output']))
        if (useVars.length > 0) {
          showRemoveVarConfirm()
          setRemovedVars(useVars.map(item => [id, item.group_name, 'output']))
          setRemoveType('enableChanged')
          return
        }
      }

      handleOutVarRenameChange(id, [id, inputs.advanced_settings.groups[0].group_name, 'output'], [id, 'output'])
    }

    setInputs(toggleGroupEnabled({ inputs, enabled }))
    deleteNodeInspectorVars(id)
  }, [deleteNodeInspectorVars, handleOutVarRenameChange, id, inputs, isVarUsedInNodes, setInputs, showRemoveVarConfirm])

  const handleAddGroup = useCallback(() => {
    setInputs(addGroup(inputs))
    deleteNodeInspectorVars(id)
  }, [deleteNodeInspectorVars, id, inputs, setInputs])

  // record the first old name value
  const oldNameRef = useRef<Record<string, string>>({})

  const {
    run: renameInspectNameWithDebounce,
  } = useDebounceFn(
    (id: string, newName: string) => {
      const oldName = oldNameRef.current[id]
      renameInspectVarName(id, oldName, newName)
      delete oldNameRef.current[id]
    },
    { wait: 500 },
  )

  const handleVarGroupNameChange = useCallback((groupId: string) => {
    return (name: string) => {
      const index = inputs.advanced_settings.groups.findIndex(item => item.groupId === groupId)
      handleOutVarRenameChange(id, [id, inputs.advanced_settings.groups[index].group_name, 'output'], [id, name, 'output'])
      setInputs(renameGroup(inputs, groupId, name))
      if (!(id in oldNameRef.current))
        oldNameRef.current[id] = inputs.advanced_settings.groups[index].group_name
      renameInspectNameWithDebounce(id, name)
    }
  }, [handleOutVarRenameChange, id, inputs, renameInspectNameWithDebounce, setInputs])

  const onRemoveVarConfirm = useCallback(() => {
    removedVars.forEach((v) => {
      removeUsedVarInNodes(v)
    })
    hideRemoveVarConfirm()
    if (removeType === 'group') {
      setInputs(removeGroupByIndex(inputs, removedGroupIndex))
    }
    else {
      // removeType === 'enableChanged' to enabled
      setInputs(toggleGroupEnabled({ inputs, enabled: false }))
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
    filterVar: filterVarByType,
  }
}

export default useConfig
