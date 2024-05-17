import { useCallback } from 'react'
import produce from 'immer'
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

  const handleGroupEnabledChange = useCallback((value: boolean) => {
    const newInputs = produce(inputs, (draft) => {
      if (!draft.advanced_settings)
        draft.advanced_settings = { group_enabled: false, groups: [] }
      if (value) {
        draft.advanced_settings.groups = [{
          output_type: draft.output_type,
          variables: draft.variables,
          group_name: 'Group 1',
        }]
      }
      else {
        if (draft.advanced_settings.groups.length > 0) {
          draft.output_type = draft.advanced_settings.groups[0].output_type
          draft.variables = draft.advanced_settings.groups[0].variables
        }
      }
      draft.advanced_settings.group_enabled = value
    })
    setInputs(newInputs)
  }, [inputs, setInputs])

  return {
    readOnly,
    inputs,
    handleListOrTypeChange,
    isEnableGroup,
    handleGroupEnabledChange,
  }
}

export default useConfig
