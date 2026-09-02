import type { ValueSelector, Var } from '../../types'
import type {
  KnowledgeRetrievalV2MetadataFilters,
  KnowledgeRetrievalV2Mode,
  KnowledgeRetrievalV2NodeKind,
  KnowledgeRetrievalV2NodeType,
  KnowledgeRetrievalV2RerankingModel,
  KnowledgeRetrievalV2SpaceSummary,
} from './types'
import type {
  HandleAddCondition,
  HandleRemoveCondition,
  HandleToggleConditionLogicalOperator,
  HandleUpdateCondition,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { produce } from 'immer'
import { useCallback } from 'react'
import { v4 as uuid4 } from 'uuid'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { useNodesReadOnly } from '../../hooks/use-workflow'
import { VarType } from '../../types'
import { toggleControlSpaceId } from './config-helpers'
import { KNOWLEDGE_RETRIEVAL_V2_TOP_N_MAX } from './constants'

const useConfig = (id: string, payload: KnowledgeRetrievalV2NodeType) => {
  const { nodesReadOnly: readOnly } = useNodesReadOnly()
  const { inputs, setInputs } = useNodeCrud<KnowledgeRetrievalV2NodeType>(id, payload)

  const handleQueryVarChange = useCallback(
    (selector: ValueSelector | string) => {
      setInputs(
        produce(inputs, (draft) => {
          draft.query_variable_selector = selector as ValueSelector
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleQueryAttachmentChange = useCallback(
    (selector: ValueSelector | string) => {
      setInputs(
        produce(inputs, (draft) => {
          draft.query_attachment_selector = selector as ValueSelector
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleSpaceToggle = useCallback(
    (space: KnowledgeRetrievalV2SpaceSummary) => {
      setInputs(
        produce(inputs, (draft) => {
          const selected = toggleControlSpaceId(draft.control_space_ids, space.control_space_id)
          draft.control_space_ids = selected
          const summaries = new Map(
            (draft._control_spaces ?? []).map((item) => [item.control_space_id, item]),
          )
          summaries.set(space.control_space_id, space)
          draft._control_spaces = selected.map(
            (controlSpaceId) =>
              summaries.get(controlSpaceId) ?? {
                control_space_id: controlSpaceId,
                name: controlSpaceId,
              },
          )
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleSpacesChange = useCallback(
    (spaces: KnowledgeRetrievalV2SpaceSummary[]) => {
      setInputs(
        produce(inputs, (draft) => {
          draft.control_space_ids = spaces.map((space) => space.control_space_id)
          draft._control_spaces = spaces
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleModeChange = useCallback(
    (mode?: KnowledgeRetrievalV2Mode) => {
      setInputs(
        produce(inputs, (draft) => {
          draft.mode = mode
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleTopNChange = useCallback(
    (topN: number) => {
      if (!Number.isInteger(topN) || topN < 1 || topN > KNOWLEDGE_RETRIEVAL_V2_TOP_N_MAX) return
      setInputs(
        produce(inputs, (draft) => {
          draft.top_n = topN
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleRerankingModelChange = useCallback(
    (model?: KnowledgeRetrievalV2RerankingModel) => {
      setInputs(
        produce(inputs, (draft) => {
          draft.reranking_model = model
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleScoreThresholdChange = useCallback(
    (scoreThreshold: number | null) => {
      if (
        scoreThreshold !== null &&
        (!Number.isFinite(scoreThreshold) || scoreThreshold < 0 || scoreThreshold > 1)
      )
        return
      setInputs(
        produce(inputs, (draft) => {
          draft.score_threshold = scoreThreshold
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleMetadataFilterChange = useCallback(
    <K extends keyof KnowledgeRetrievalV2MetadataFilters>(
      key: K,
      value: KnowledgeRetrievalV2MetadataFilters[K],
    ) => {
      setInputs(
        produce(inputs, (draft) => {
          draft.metadata_filters = draft.metadata_filters ?? {}
          if (value === undefined || (Array.isArray(value) && value.length === 0))
            delete draft.metadata_filters[key]
          else draft.metadata_filters[key] = value as never
          if (Object.keys(draft.metadata_filters).length === 0) delete draft.metadata_filters
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleNodeKindToggle = useCallback(
    (nodeKind: KnowledgeRetrievalV2NodeKind) => {
      const current = inputs.metadata_filters?.node_kinds ?? []
      const next = current.includes(nodeKind)
        ? current.filter((item) => item !== nodeKind)
        : [...current, nodeKind]
      handleMetadataFilterChange('node_kinds', next)
    },
    [handleMetadataFilterChange, inputs.metadata_filters?.node_kinds],
  )

  const handleMetadataFilterModeChange = useCallback(
    (mode: MetadataFilteringModeEnum) => {
      setInputs(
        produce(inputs, (draft) => {
          draft.metadata_filtering_mode =
            mode === MetadataFilteringModeEnum.manual
              ? MetadataFilteringModeEnum.manual
              : MetadataFilteringModeEnum.disabled
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleAddCondition = useCallback<HandleAddCondition>(
    ({ id: metadataId, name, type }) => {
      setInputs(
        produce(inputs, (draft) => {
          const condition = {
            id: uuid4(),
            metadata_id: metadataId,
            metadata_type: type,
            name,
            comparison_operator:
              type === MetadataFilteringVariableType.number
                ? ComparisonOperator.equal
                : ComparisonOperator.is,
          }
          if (draft.metadata_filtering_conditions) {
            draft.metadata_filtering_conditions.conditions.push(condition)
            return
          }
          draft.metadata_filtering_conditions = {
            logical_operator: LogicalOperator.and,
            conditions: [condition],
          }
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleRemoveCondition = useCallback<HandleRemoveCondition>(
    (conditionId) => {
      setInputs(
        produce(inputs, (draft) => {
          const conditions = draft.metadata_filtering_conditions?.conditions
          const index = conditions?.findIndex((condition) => condition.id === conditionId) ?? -1
          if (index >= 0) conditions?.splice(index, 1)
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleUpdateCondition = useCallback<HandleUpdateCondition>(
    (conditionId, condition) => {
      setInputs(
        produce(inputs, (draft) => {
          const conditions = draft.metadata_filtering_conditions?.conditions
          const index = conditions?.findIndex((item) => item.id === conditionId) ?? -1
          if (index >= 0 && conditions) conditions[index] = condition
        }),
      )
    },
    [inputs, setInputs],
  )

  const handleToggleConditionLogicalOperator =
    useCallback<HandleToggleConditionLogicalOperator>(() => {
      setInputs(
        produce(inputs, (draft) => {
          const filters = draft.metadata_filtering_conditions
          if (!filters) return
          filters.logical_operator =
            filters.logical_operator === LogicalOperator.and
              ? LogicalOperator.or
              : LogicalOperator.and
        }),
      )
    }, [inputs, setInputs])

  const filterStringVar = useCallback((variable: Var) => variable.type === VarType.string, [])
  const filterNumberVar = useCallback((variable: Var) => variable.type === VarType.number, [])
  const filterFileVar = useCallback(
    (variable: Var) => variable.type === VarType.file || variable.type === VarType.arrayFile,
    [],
  )

  const {
    availableVars: availableStringVars,
    availableNodesWithParent: availableStringNodesWithParent,
  } = useAvailableVarList(id, { filterVar: filterStringVar, onlyLeafNodeVar: false })
  const {
    availableVars: availableNumberVars,
    availableNodesWithParent: availableNumberNodesWithParent,
  } = useAvailableVarList(id, { filterVar: filterNumberVar, onlyLeafNodeVar: false })

  return {
    readOnly,
    inputs,
    availableNumberNodesWithParent,
    availableNumberVars,
    availableStringNodesWithParent,
    availableStringVars,
    filterFileVar,
    filterStringVar,
    handleAddCondition,
    handleMetadataFilterChange,
    handleMetadataFilterModeChange,
    handleModeChange,
    handleNodeKindToggle,
    handleQueryAttachmentChange,
    handleQueryVarChange,
    handleRerankingModelChange,
    handleRemoveCondition,
    handleScoreThresholdChange,
    handleSpaceToggle,
    handleSpacesChange,
    handleTopNChange,
    handleToggleConditionLogicalOperator,
    handleUpdateCondition,
  }
}

export default useConfig
