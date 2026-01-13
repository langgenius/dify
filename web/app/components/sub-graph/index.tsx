import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SubGraphProps } from './types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { PromptItem } from '@/app/components/workflow/types'
import { memo, useMemo } from 'react'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { BlockEnum, PromptRole } from '@/app/components/workflow/types'
import SubGraphMain from './components/sub-graph-main'
import { useSubGraphNodes } from './hooks'
import { createSubGraphSlice } from './store'

const defaultViewport: Viewport = {
  x: 50,
  y: 50,
  zoom: 1,
}

const SubGraph: FC<SubGraphProps> = (props) => {
  const {
    toolNodeId,
    paramKey,
    agentName,
    agentNodeId,
    extractorNode,
    toolParamValue,
  } = props

  const promptText = useMemo(() => {
    if (!toolParamValue)
      return ''
    // Reason: escape agent id before building a regex pattern.
    const escapedAgentId = agentNodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const leadingPattern = new RegExp(`^\\{\\{[@#]${escapedAgentId}\\.context[@#]\\}\\}`)
    return toolParamValue.replace(leadingPattern, '')
  }, [agentNodeId, toolParamValue])

  const startNode = useMemo(() => {
    return {
      id: 'subgraph-source',
      type: 'custom',
      position: { x: 100, y: 150 },
      data: {
        type: BlockEnum.Start,
        title: agentName,
        desc: '',
        _connectedSourceHandleIds: ['source'],
        _connectedTargetHandleIds: [],
        variables: [],
      },
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
      deletable: false,
    }
  }, [agentName])

  const extractorDisplayNode = useMemo(() => {
    if (!extractorNode)
      return null

    const nextPromptTemplate = Array.isArray(extractorNode.data.prompt_template)
      ? extractorNode.data.prompt_template.map((item: PromptItem) => {
          if (item.role === PromptRole.system)
            return { ...item, text: promptText }
          return item
        })
      : {
          ...extractorNode.data.prompt_template,
          text: promptText,
        }

    const hasSystemPrompt = Array.isArray(nextPromptTemplate)
      && nextPromptTemplate.some((item: PromptItem) => item.role === PromptRole.system)
    const normalizedPromptTemplate = Array.isArray(nextPromptTemplate)
      ? (hasSystemPrompt ? nextPromptTemplate : [{ role: PromptRole.system, text: promptText }, ...nextPromptTemplate])
      : nextPromptTemplate

    return {
      ...extractorNode,
      hidden: false,
      position: { x: 450, y: 150 },
      data: {
        ...extractorNode.data,
        prompt_template: normalizedPromptTemplate,
      },
    }
  }, [extractorNode, promptText])

  const nodesSource = useMemo(() => {
    if (!extractorDisplayNode)
      return [startNode]

    return [startNode, extractorDisplayNode]
  }, [extractorDisplayNode, startNode])

  const edgesSource = useMemo(() => {
    if (!extractorDisplayNode)
      return []

    return [
      {
        id: `${startNode.id}-${extractorDisplayNode.id}`,
        source: startNode.id,
        sourceHandle: 'source',
        target: extractorDisplayNode.id,
        targetHandle: 'target',
        type: 'custom',
        selectable: false,
        data: {
          sourceType: BlockEnum.Start,
          targetType: BlockEnum.LLM,
          _isTemp: true,
          _isSubGraphTemp: true,
        },
      },
    ]
  }, [extractorDisplayNode, startNode])

  const { nodes, edges } = useSubGraphNodes(nodesSource, edgesSource)

  return (
    <WorkflowWithDefaultContext
      nodes={nodes}
      edges={edges}
    >
      <SubGraphMain
        nodes={nodes}
        edges={edges}
        viewport={defaultViewport}
        toolNodeId={toolNodeId}
        paramKey={paramKey}
      />
    </WorkflowWithDefaultContext>
  )
}

const SubGraphWrapper: FC<SubGraphProps> = (props) => {
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createSubGraphSlice as unknown as InjectWorkflowStoreSliceFn}
    >
      <SubGraph {...props} />
    </WorkflowContextProvider>
  )
}

export default memo(SubGraphWrapper)
