import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SubGraphProps } from './types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { PromptItem } from '@/app/components/workflow/types'
import { memo, useMemo } from 'react'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { BlockEnum, EditionType, PromptRole } from '@/app/components/workflow/types'
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
    onSave,
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

    const updateSystemPrompt = (item: PromptItem) => {
      if (item.role !== PromptRole.system)
        return item
      if (item.edition_type === EditionType.jinja2) {
        return {
          ...item,
          text: promptText,
          jinja2_text: promptText,
        }
      }
      return { ...item, text: promptText }
    }

    const nextPromptTemplate = Array.isArray(extractorNode.data.prompt_template)
      ? extractorNode.data.prompt_template.map(updateSystemPrompt)
      : updateSystemPrompt(extractorNode.data.prompt_template as PromptItem)

    const hasSystemPrompt = Array.isArray(nextPromptTemplate)
      && nextPromptTemplate.some((item: PromptItem) => item.role === PromptRole.system)
    const defaultSystemPrompt: PromptItem = (() => {
      const useJinja = Array.isArray(nextPromptTemplate)
        && nextPromptTemplate.some((item: PromptItem) => item.edition_type === EditionType.jinja2)
      if (useJinja) {
        return {
          role: PromptRole.system,
          text: promptText,
          jinja2_text: promptText,
          edition_type: EditionType.jinja2,
        }
      }
      return { role: PromptRole.system, text: promptText }
    })()
    const normalizedPromptTemplate = Array.isArray(nextPromptTemplate)
      ? (hasSystemPrompt ? nextPromptTemplate : [defaultSystemPrompt, ...nextPromptTemplate])
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
        onSave={onSave}
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
