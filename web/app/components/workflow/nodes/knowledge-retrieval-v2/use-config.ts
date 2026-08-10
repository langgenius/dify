import type { ValueSelector, Var } from '../../types'
import type {
  KnowledgeRetrievalV2MetadataFilters,
  KnowledgeRetrievalV2Mode,
  KnowledgeRetrievalV2NodeKind,
  KnowledgeRetrievalV2NodeType,
  KnowledgeRetrievalV2SpaceSummary,
} from './types'
import { produce } from 'immer'
import { useCallback } from 'react'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useNodesReadOnly } from '../../hooks/use-workflow'
import { VarType } from '../../types'
import { toggleControlSpaceId } from './config-helpers'

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
      if (!Number.isInteger(topN) || topN < 1 || topN > 100) return
      setInputs(
        produce(inputs, (draft) => {
          draft.top_n = topN
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

  const filterStringVar = useCallback((variable: Var) => variable.type === VarType.string, [])

  return {
    readOnly,
    inputs,
    filterStringVar,
    handleMetadataFilterChange,
    handleModeChange,
    handleNodeKindToggle,
    handleQueryVarChange,
    handleSpaceToggle,
    handleTopNChange,
  }
}

export default useConfig
