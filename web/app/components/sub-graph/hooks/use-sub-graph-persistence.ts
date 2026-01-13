import type { SubGraphConfig } from '../types'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import type { Edge, Node } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'

type SubGraphPersistenceProps = {
  toolNodeId: string
  paramKey: string
}

export type SubGraphData = {
  nodes: Node[]
  edges: Edge[]
  config: SubGraphConfig
}

const SUB_GRAPH_DATA_PREFIX = '__subgraph__'

export const useSubGraphPersistence = ({
  toolNodeId,
  paramKey,
}: SubGraphPersistenceProps) => {
  const { inputs, setInputs } = useNodeCrud<ToolNodeType>(toolNodeId, {} as ToolNodeType)

  const getSubGraphDataKey = useCallback(() => {
    return `${SUB_GRAPH_DATA_PREFIX}${paramKey}`
  }, [paramKey])

  const loadSubGraphData = useCallback((): SubGraphData | null => {
    const dataKey = getSubGraphDataKey()
    const toolParameters = inputs.tool_parameters || {}
    const storedData = toolParameters[dataKey]

    if (!storedData || storedData.type !== VarKindType.constant) {
      return null
    }

    try {
      const parsed = typeof storedData.value === 'string'
        ? JSON.parse(storedData.value)
        : storedData.value

      return parsed as SubGraphData
    }
    catch {
      return null
    }
  }, [getSubGraphDataKey, inputs.tool_parameters])

  const saveSubGraphData = useCallback((data: SubGraphData) => {
    const dataKey = getSubGraphDataKey()
    const newToolParameters = {
      ...inputs.tool_parameters,
      [dataKey]: {
        type: VarKindType.constant,
        value: JSON.stringify(data),
      },
    }

    setInputs({
      ...inputs,
      tool_parameters: newToolParameters,
    })
  }, [getSubGraphDataKey, inputs, setInputs])

  const hasSubGraphData = useCallback(() => {
    const dataKey = getSubGraphDataKey()
    const toolParameters = inputs.tool_parameters || {}
    return !!toolParameters[dataKey]
  }, [getSubGraphDataKey, inputs.tool_parameters])

  const updateSubGraphConfig = useCallback((
    config: Partial<SubGraphConfig>,
  ) => {
    const existingData = loadSubGraphData()
    if (!existingData)
      return

    saveSubGraphData({
      ...existingData,
      config: {
        ...existingData.config,
        ...config,
      },
    })
  }, [loadSubGraphData, saveSubGraphData])

  const updateSubGraphNodes = useCallback((
    nodes: Node[],
    edges: Edge[],
  ) => {
    const existingData = loadSubGraphData()
    const defaultConfig: SubGraphConfig = {
      enabled: true,
      startNodeId: nodes[0]?.id || '',
      selectedOutputVar: [],
      whenOutputNone: 'default',
    }

    saveSubGraphData({
      nodes,
      edges,
      config: existingData?.config || defaultConfig,
    })
  }, [loadSubGraphData, saveSubGraphData])

  return {
    loadSubGraphData,
    saveSubGraphData,
    hasSubGraphData,
    updateSubGraphConfig,
    updateSubGraphNodes,
  }
}
