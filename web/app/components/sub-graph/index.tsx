import type { FC } from 'react'
import type { Viewport } from 'reactflow'
import type { SubGraphProps } from './types'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store'
import type { PromptItem, PromptTemplateItem } from '@/app/components/workflow/types'
import { memo, useEffect, useMemo } from 'react'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { NODE_WIDTH_X_OFFSET, START_INITIAL_POSITION } from '@/app/components/workflow/constants'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { CUSTOM_SUB_GRAPH_START_NODE } from '@/app/components/workflow/nodes/sub-graph-start/constants'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, EditionType, isPromptMessageContext, PromptRole } from '@/app/components/workflow/types'
import SubGraphMain from './components/sub-graph-main'
import { useSubGraphNodes } from './hooks'
import { createSubGraphSlice } from './store'

const SUB_GRAPH_EDGE_GAP = 160
const SUB_GRAPH_ENTRY_POSITION = {
  x: START_INITIAL_POSITION.x,
  y: 150,
}
const SUB_GRAPH_EXTRACTOR_POSITION = {
  x: SUB_GRAPH_ENTRY_POSITION.x + NODE_WIDTH_X_OFFSET - SUB_GRAPH_EDGE_GAP,
  y: SUB_GRAPH_ENTRY_POSITION.y,
}

const defaultViewport: Viewport = {
  x: SUB_GRAPH_EDGE_GAP,
  y: 50,
  zoom: 1.3,
}

const SubGraphContent: FC<SubGraphProps> = (props) => {
  const {
    toolNodeId,
    paramKey,
    toolParamValue,
    parentAvailableNodes,
    parentAvailableVars,
    configsMap,
    selectableNodeTypes,
    onSave,
    onSyncWorkflowDraft,
  } = props

  const isAgentVariant = props.variant === 'agent'
  const sourceTitle = isAgentVariant ? (props.agentName || '') : (props.title || '')
  const resolvedAgentNodeId = isAgentVariant ? props.agentNodeId : ''

  const setParentAvailableVars = useStore(state => state.setParentAvailableVars)
  const setParentAvailableNodes = useStore(state => state.setParentAvailableNodes)

  useEffect(() => {
    setParentAvailableVars?.(parentAvailableVars || [])
    setParentAvailableNodes?.(parentAvailableNodes || [])
  }, [parentAvailableNodes, parentAvailableVars, setParentAvailableNodes, setParentAvailableVars])

  const promptText = useMemo(() => {
    if (!isAgentVariant || !toolParamValue)
      return ''
    // Reason: escape agent id before building a regex pattern.
    const escapedAgentId = resolvedAgentNodeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const leadingPattern = new RegExp(`^\\{\\{[@#]${escapedAgentId}\\.context[@#]\\}\\}`)
    return toolParamValue.replace(leadingPattern, '')
  }, [isAgentVariant, resolvedAgentNodeId, toolParamValue])

  const startNode = useMemo(() => {
    if (!isAgentVariant) {
      return {
        id: 'subgraph-source',
        type: CUSTOM_SUB_GRAPH_START_NODE,
        position: SUB_GRAPH_ENTRY_POSITION,
        data: {
          type: BlockEnum.Start,
          title: sourceTitle,
          desc: '',
          selected: false,
          iconType: 'assemble',
          variables: [],
        },
        selected: false,
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
        deletable: false,
      }
    }

    return {
      id: 'subgraph-source',
      type: CUSTOM_SUB_GRAPH_START_NODE,
      position: SUB_GRAPH_ENTRY_POSITION,
      data: {
        type: BlockEnum.Start,
        title: sourceTitle,
        desc: '',
        selected: false,
        iconType: 'agent',
        variables: [],
      },
      selected: false,
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
      deletable: false,
    }
  }, [isAgentVariant, sourceTitle])

  const extractorDisplayNode = useMemo(() => {
    if (isAgentVariant) {
      const extractorNode = props.extractorNode
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

        const userIndex = template.findIndex(
          item => !isPromptMessageContext(item) && (item as PromptItem).role === PromptRole.user,
        )
        if (userIndex >= 0) {
          return template.map((item, index) => {
            if (index !== userIndex)
              return item
            return applyPromptText(item as PromptItem)
          }) as PromptTemplateItem[]
        }

        const useJinja = template.some(
          item => !isPromptMessageContext(item) && (item as PromptItem).edition_type === EditionType.jinja2,
        )
        const defaultUserPrompt: PromptItem = useJinja
          ? {
              role: PromptRole.user,
              text: promptText,
              jinja2_text: promptText,
              edition_type: EditionType.jinja2,
            }
          : { role: PromptRole.user, text: promptText }
        return [...template, defaultUserPrompt] as PromptTemplateItem[]
      })()

      return {
        ...extractorNode,
        hidden: false,
        selected: false,
        position: SUB_GRAPH_EXTRACTOR_POSITION,
        data: {
          ...extractorNode.data,
          selected: false,
          prompt_template: nextPromptTemplate,
        },
      }
    }

    const extractorNode = props.extractorNode
    if (!extractorNode)
      return null

    return {
      ...extractorNode,
      hidden: false,
      selected: false,
      position: SUB_GRAPH_EXTRACTOR_POSITION,
      data: {
        ...extractorNode.data,
        selected: false,
      },
    }
  }, [isAgentVariant, promptText, props.extractorNode])

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
          targetType: isAgentVariant ? BlockEnum.LLM : BlockEnum.Code,
          _isTemp: true,
          _isSubGraphTemp: true,
        },
      },
    ]
  }, [extractorDisplayNode, isAgentVariant, startNode])

  const { nodes, edges } = useSubGraphNodes(nodesSource, edgesSource)

  if (isAgentVariant) {
    return (
      <WorkflowWithDefaultContext
        nodes={nodes}
        edges={edges}
      >
        <SubGraphMain
          variant="agent"
          nodes={nodes}
          edges={edges}
          viewport={defaultViewport}
          title={sourceTitle}
          extractorNodeId={`${toolNodeId}_ext_${paramKey}`}
          configsMap={configsMap}
          mentionConfig={props.mentionConfig}
          onMentionConfigChange={props.onMentionConfigChange}
          selectableNodeTypes={selectableNodeTypes}
          onSave={onSave}
          onSyncWorkflowDraft={onSyncWorkflowDraft}
        />
      </WorkflowWithDefaultContext>
    )
  }

  return (
    <WorkflowWithDefaultContext
      nodes={nodes}
      edges={edges}
    >
      <SubGraphMain
        variant="assemble"
        nodes={nodes}
        edges={edges}
        viewport={defaultViewport}
        title={sourceTitle}
        extractorNodeId={`${toolNodeId}_ext_${paramKey}`}
        configsMap={configsMap}
        selectableNodeTypes={selectableNodeTypes}
        onSave={onSave}
        onSyncWorkflowDraft={onSyncWorkflowDraft}
      />
    </WorkflowWithDefaultContext>
  )
}

const SubGraph: FC<SubGraphProps> = (props) => {
  return (
    <WorkflowContextProvider
      injectWorkflowStoreSliceFn={createSubGraphSlice as InjectWorkflowStoreSliceFn}
    >
      <SubGraphContent {...props} />
    </WorkflowContextProvider>
  )
}

export default memo(SubGraph)
