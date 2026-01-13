import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SubGraphProps } from './types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { PromptItem } from '@/app/components/workflow/types'
import { memo, useMemo } from 'react'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { NODE_WIDTH_X_OFFSET, START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { BlockEnum, EditionType, PromptRole } from '@/app/components/workflow/types'
import SubGraphMain from './components/sub-graph-main'
import { useSubGraphNodes } from './hooks'
import { createSubGraphSlice } from './store'

const SUB_GRAPH_EDGE_GAP = 180
const SUB_GRAPH_ENTRY_POSITION = {
  x: START_INITIAL_POSITION.x,
  y: 150,
}
const SUB_GRAPH_LLM_POSITION = {
  x: SUB_GRAPH_ENTRY_POSITION.x + NODE_WIDTH_X_OFFSET - SUB_GRAPH_EDGE_GAP,
  y: SUB_GRAPH_ENTRY_POSITION.y,
}

const defaultViewport: Viewport = {
  x: SUB_GRAPH_EDGE_GAP,
  y: 50,
  zoom: 1.3,
}

const SubGraph: FC<SubGraphProps> = (props) => {
  const {
    toolNodeId,
    paramKey,
    agentName,
    agentNodeId,
    mentionConfig,
    onMentionConfigChange,
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
      position: SUB_GRAPH_ENTRY_POSITION,
      data: {
        type: BlockEnum.Start,
        title: agentName,
        desc: '',
        _connectedSourceHandleIds: ['source'],
        _connectedTargetHandleIds: [],
        _subGraphEntry: true,
        _iconTypeOverride: BlockEnum.Agent,
        selected: false,
        variables: [],
      },
      selected: false,
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

    const applyPromptText = (item: PromptItem) => {
      if (item.edition_type === EditionType.jinja2) {
        return {
          ...item,
          text: promptText,
          jinja2_text: promptText,
        }
      }
      return { ...item, text: promptText }
    }

    const nextPromptTemplate = (() => {
      const template = extractorNode.data.prompt_template
      if (!Array.isArray(template))
        return applyPromptText(template as PromptItem)

      const userIndex = template.findIndex(item => item.role === PromptRole.user)
      if (userIndex >= 0) {
        return template.map((item, index) => {
          if (index !== userIndex)
            return item
          return applyPromptText(item)
        })
      }

      const useJinja = template.some((item: PromptItem) => item.edition_type === EditionType.jinja2)
      const defaultUserPrompt: PromptItem = useJinja
        ? {
            role: PromptRole.user,
            text: promptText,
            jinja2_text: promptText,
            edition_type: EditionType.jinja2,
          }
        : { role: PromptRole.user, text: promptText }
      const systemIndex = template.findIndex(item => item.role === PromptRole.system)
      const nextTemplate = [...template]
      if (systemIndex >= 0)
        nextTemplate.splice(systemIndex + 1, 0, defaultUserPrompt)
      else
        nextTemplate.unshift(defaultUserPrompt)
      return nextTemplate
    })()

    return {
      ...extractorNode,
      hidden: false,
      selected: false,
      position: SUB_GRAPH_LLM_POSITION,
      data: {
        ...extractorNode.data,
        selected: false,
        prompt_template: nextPromptTemplate,
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
        agentName={agentName}
        extractorNodeId={`${toolNodeId}_ext_${paramKey}`}
        mentionConfig={mentionConfig}
        onMentionConfigChange={onMentionConfigChange}
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
