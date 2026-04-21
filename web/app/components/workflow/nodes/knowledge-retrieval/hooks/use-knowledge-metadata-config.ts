import type { MutableRefObject } from 'react'
import type {
  HandleAddCondition,
  HandleRemoveCondition,
  HandleToggleConditionLogicalOperator,
  HandleUpdateCondition,
  KnowledgeRetrievalNodeType,
  MetadataFilteringModeEnum,
} from '../types'
import type { Var } from '@/app/components/workflow/types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { v4 as uuid4 } from 'uuid'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import { AppModeEnum } from '@/types/app'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringVariableType,
} from '../types'

type Params = {
  id: string
  inputRef: MutableRefObject<KnowledgeRetrievalNodeType>
  setInputs: (inputs: KnowledgeRetrievalNodeType) => void
}

const filterStringVar = (varPayload: Var) => {
  return varPayload.type === VarType.string
}

const filterNumberVar = (varPayload: Var) => {
  return varPayload.type === VarType.number
}

const filterFileVar = (varPayload: Var) => {
  return varPayload.type === VarType.file || varPayload.type === VarType.arrayFile
}

const useKnowledgeMetadataConfig = ({
  id,
  inputRef,
  setInputs,
}: Params) => {
  const handleMetadataFilterModeChange = useCallback((newMode: MetadataFilteringModeEnum) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.metadata_filtering_mode = newMode
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleAddCondition = useCallback<HandleAddCondition>(({ id, name, type }) => {
    const comparisonOperator = type === MetadataFilteringVariableType.number
      ? ComparisonOperator.equal
      : ComparisonOperator.is

    const nextInputs = produce(inputRef.current, (draft) => {
      const newCondition = {
        id: uuid4(),
        metadata_id: id,
        name,
        comparison_operator: comparisonOperator,
      }

      if (draft.metadata_filtering_conditions) {
        draft.metadata_filtering_conditions.conditions.push(newCondition)
        return
      }

      draft.metadata_filtering_conditions = {
        logical_operator: LogicalOperator.and,
        conditions: [newCondition],
      }
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((conditionId) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      const conditions = draft.metadata_filtering_conditions?.conditions || []
      const index = conditions.findIndex(condition => condition.id === conditionId)
      if (index > -1)
        draft.metadata_filtering_conditions?.conditions.splice(index, 1)
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((conditionId, newCondition) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      const conditions = draft.metadata_filtering_conditions?.conditions || []
      const index = conditions.findIndex(condition => condition.id === conditionId)
      if (index > -1)
        draft.metadata_filtering_conditions!.conditions[index] = newCondition
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleToggleConditionLogicalOperator = useCallback<HandleToggleConditionLogicalOperator>(() => {
    const nextInputs = produce(inputRef.current, (draft) => {
      const currentLogicalOperator = draft.metadata_filtering_conditions?.logical_operator
      draft.metadata_filtering_conditions!.logical_operator = currentLogicalOperator === LogicalOperator.and
        ? LogicalOperator.or
        : LogicalOperator.and
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleMetadataModelChange = useCallback((model: { provider: string, modelId: string, mode?: string }) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.metadata_model_config = {
        provider: model.provider,
        name: model.modelId,
        mode: model.mode || AppModeEnum.CHAT,
        completion_params: draft.metadata_model_config?.completion_params || { temperature: 0.7 },
      }
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const handleMetadataCompletionParamsChange = useCallback((newParams: Record<string, unknown>) => {
    const nextInputs = produce(inputRef.current, (draft) => {
      draft.metadata_model_config = {
        ...draft.metadata_model_config!,
        completion_params: newParams,
      }
    })
    setInputs(nextInputs)
  }, [inputRef, setInputs])

  const {
    availableVars: availableStringVars,
    availableNodesWithParent: availableStringNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterStringVar,
  })

  const {
    availableVars: availableNumberVars,
    availableNodesWithParent: availableNumberNodesWithParent,
  } = useAvailableVarList(id, {
    onlyLeafNodeVar: false,
    filterVar: filterNumberVar,
  })

  return {
    filterStringVar,
    filterFileVar,
    handleMetadataFilterModeChange,
    handleAddCondition,
    handleRemoveCondition,
    handleUpdateCondition,
    handleToggleConditionLogicalOperator,
    handleMetadataModelChange,
    handleMetadataCompletionParamsChange,
    availableStringVars,
    availableStringNodesWithParent,
    availableNumberVars,
    availableNumberNodesWithParent,
  }
}

export default useKnowledgeMetadataConfig
