import type { BackendEdgeSpec, BackendNodeSpec } from '@/service/debug'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import { generateFlowchartStream } from '@/service/debug'
import { useNodesReadOnly } from '../../hooks/use-workflow'
import { useWorkflowStore } from '../../store'
import { useVibeGraphParser } from './use-vibe-graph-parser'
import { useVibeResources } from './use-vibe-resources'
import { useVibeState } from './use-vibe-state'
import { useWorkflowApplier } from './use-workflow-applier'
import { isMermaidFlowchart } from './utils'

export const useVibeGeneratorApi = () => {
  const { t } = useTranslation('workflow')
  const workflowStore = useWorkflowStore()
  const { getNodesReadOnly } = useNodesReadOnly()

  const { availableNodesList, toolOptions, language } = useVibeResources()
  const { getLatestModelConfig, modelList } = useVibeState()
  const { applyBackendNodesToWorkflow, applyFlowchartToWorkflow } = useWorkflowApplier()
  const { createGraphFromBackendNodes, flowchartToWorkflowGraph } = useVibeGraphParser()

  // Use a ref for local tracking of generation status to prevent race conditions
  const isGeneratingRef = useRef(false)
  const lastInstructionRef = useRef<string>('')

  const handleVibeCommand = useCallback(async (
    dsl?: string,
    skipPanelPreview = false,
    regenerateMode = false,
  ) => {
    if (getNodesReadOnly()) {
      Toast.notify({ type: 'error', message: t('vibe.readOnly') })
      return
    }

    const trimmed = dsl?.trim() || ''
    if (!trimmed) {
      Toast.notify({ type: 'error', message: t('vibe.missingInstruction') })
      return
    }

    // Checking if nodesMetaDataMap is available can be done via checking availableNodesList length
    // Though availableNodesList is an array, if empty it might mean no nodes.
    // However, nodesMetaDataMap was used in original code from useNodesMetaData hook.
    // Here we use availableNodesList which is derived from it.
    // Ideally we should check if we have basic nodes.
    if (!availableNodesList || availableNodesList.length === 0) {
      Toast.notify({ type: 'error', message: t('vibe.nodesUnavailable') })
      return
    }

    const latestModelConfig = getLatestModelConfig()
    if (!latestModelConfig && !isMermaidFlowchart(trimmed)) {
      Toast.notify({ type: 'error', message: t('vibe.modelUnavailable') })
      return
    }

    if (isGeneratingRef.current)
      return
    isGeneratingRef.current = true

    if (!isMermaidFlowchart(trimmed))
      lastInstructionRef.current = trimmed

    workflowStore.setState(state => ({
      ...state,
      showVibePanel: true,
      isVibeGenerating: true,
      vibePanelMermaidCode: '',
      vibePanelInstruction: trimmed,
      vibePanelIntent: '',
      vibePanelMessage: '',
      vibePanelSuggestions: [],
    }))

    try {
      const {
        setIsVibeGenerating,
      } = workflowStore.getState()

      // Refinement mode removed - always start fresh
      const existingNodesPayload: Array<{ id: string, type: string, title: string }> = []

      const toolsPayload = toolOptions.map(tool => ({
        provider_id: tool.provider_id,
        provider_name: tool.provider_name,
        provider_type: tool.provider_type,
        tool_name: tool.tool_name,
        tool_label: tool.tool_label,
        tool_key: `${tool.provider_id}/${tool.tool_name}`,
        tool_description: tool.tool_description,
        is_team_authorization: tool.is_team_authorization,
        // Include parameter schemas so backend can inform model how to use tools
        parameters: tool.paramSchemas,
        output_schema: tool.output_schema,
      }))

      // Refinement mode removed - always use empty edges
      const existingEdgesPayload: Array<{ source: string, target: string, sourceHandle: string }> = []

      const availableNodesPayload = availableNodesList.map(node => ({
        type: node.type,
        title: node.title,
        description: node.description,
      }))

      let mermaidCode = ''
      let backendNodes: BackendNodeSpec[] | undefined
      let backendEdges: BackendEdgeSpec[] | undefined

      if (!isMermaidFlowchart(trimmed)) {
        // Build previous workflow context if regenerating
        const { vibePanelBackendNodes, vibePanelBackendEdges, vibePanelLastWarnings } = workflowStore.getState()
        const previousWorkflow = regenerateMode && vibePanelBackendNodes && vibePanelBackendNodes.length > 0
          ? {
              nodes: vibePanelBackendNodes,
              edges: vibePanelBackendEdges || [],
              warnings: vibePanelLastWarnings || [],
            }
          : undefined

        // Map language code to human-readable language name for LLM
        const languageNameMap: Record<string, string> = {
          en_US: 'English',
          zh_Hans: 'Chinese',
          zh_Hant: 'Traditional Chinese',
          ja_JP: 'Japanese',
          ko_KR: 'Korean',
          pt_BR: 'Portuguese',
          es_ES: 'Spanish',
          fr_FR: 'French',
          de_DE: 'German',
          it_IT: 'Italian',
          ru_RU: 'Russian',
          uk_UA: 'Ukrainian',
          vi_VN: 'Vietnamese',
          pl_PL: 'Polish',
          ro_RO: 'Romanian',
          tr_TR: 'Turkish',
          fa_IR: 'Persian',
          hi_IN: 'Hindi',
        }
        const preferredLanguage = languageNameMap[language] || 'English'

        // Extract available models from user's configured model providers
        const availableModelsPayload = modelList?.flatMap(provider =>
          provider.models.map(model => ({
            provider: provider.provider,
            model: model.model,
          })),
        ) || []

        const requestPayload = {
          instruction: trimmed,
          model_config: latestModelConfig,
          available_nodes: availableNodesPayload,
          existing_nodes: existingNodesPayload,
          existing_edges: existingEdgesPayload,
          available_tools: toolsPayload,
          selected_node_ids: [],
          previous_workflow: previousWorkflow,
          regenerate_mode: regenerateMode,
          language: preferredLanguage,
          available_models: availableModelsPayload,
        }

        // Use streaming API with stage progress callbacks
        const streamResult = await new Promise<{
          error?: string
          flowchart?: string
          nodes?: BackendNodeSpec[]
          edges?: BackendEdgeSpec[]
          intent?: string
          message?: string
          warnings?: string[]
          suggestions?: string[]
        }>((resolve) => {
          generateFlowchartStream(requestPayload, {
            onStage: ({ message: stageMessage }) => {
              workflowStore.setState(state => ({
                ...state,
                vibeStageMessage: stageMessage,
              }))
            },
            onComplete: (data) => {
              workflowStore.setState(state => ({
                ...state,
                vibeStageMessage: '',
              }))
              resolve(data)
            },
            onError: (errorMsg) => {
              workflowStore.setState(state => ({
                ...state,
                vibeStageMessage: '',
              }))
              resolve({ error: errorMsg })
            },
          })
        })

        const { error, flowchart, nodes, edges, intent, message, warnings, suggestions } = streamResult

        if (error) {
          Toast.notify({ type: 'error', message: error })
          workflowStore.setState(state => ({
            ...state,
            vibePanelMessage: `${error} ${t('vibe.regenerateReminder')}`,
            isVibeGenerating: false,
          }))
          return
        }

        // Handle off_topic intent - show rejection message and suggestions
        if (intent === 'off_topic') {
          workflowStore.setState(state => ({
            ...state,
            vibePanelMermaidCode: '',
            vibePanelMessage: message || t('vibe.offTopicDefault'),
            vibePanelSuggestions: suggestions || [],
            vibePanelIntent: 'off_topic',
            isVibeGenerating: false,
          }))
          return
        }

        if (!flowchart) {
          Toast.notify({ type: 'error', message: t('vibe.missingFlowchart') })
          setIsVibeGenerating(false)
          return
        }

        // Show warnings if any (includes tool sanitization warnings)
        const responseWarnings = warnings || []
        if (responseWarnings.length > 0) {
          responseWarnings.forEach((warning) => {
            Toast.notify({ type: 'warning', message: warning })
          })
        }

        mermaidCode = flowchart
        // Store backend nodes/edges for direct use (bypasses mermaid re-parsing)
        backendNodes = nodes
        backendEdges = edges
        // Store warnings for regeneration context
        workflowStore.setState(state => ({
          ...state,
          vibePanelLastWarnings: responseWarnings,
        }))

        workflowStore.setState(state => ({
          ...state,
          vibePanelMermaidCode: mermaidCode,
          vibePanelBackendNodes: backendNodes,
          vibePanelBackendEdges: backendEdges,
          vibePanelMessage: '',
          vibePanelSuggestions: [],
          vibePanelIntent: 'generate',
          isVibeGenerating: false,
        }))
      }
      else {
        // If it is mermaid flowchart code directly
        mermaidCode = trimmed
      }

      setIsVibeGenerating(false)
      workflowStore.setState(state => ({
        ...state,
        vibeStageMessage: '',
      }))

      // Add version for preview
      if (backendNodes && backendNodes.length > 0 && backendEdges) {
        const graph = await createGraphFromBackendNodes(backendNodes, backendEdges)
        workflowStore.getState().addVibeFlowVersion(graph)
      }
      else if (mermaidCode) {
        const graph = await flowchartToWorkflowGraph(mermaidCode)
        workflowStore.getState().addVibeFlowVersion(graph)
      }

      if (skipPanelPreview) {
        // Prefer backend nodes (already sanitized) over mermaid re-parsing
        if (backendNodes && backendNodes.length > 0 && backendEdges) {
          // console.log('[VIBE] Applying backend nodes directly to workflow')
          // console.log('[VIBE] Backend nodes:', backendNodes.length)
          // console.log('[VIBE] Backend edges:', backendEdges.length)
          await applyBackendNodesToWorkflow(backendNodes, backendEdges)
          // console.log('[VIBE] Backend nodes applied successfully')
        }
        else {
          // console.log('[VIBE] Applying mermaid flowchart to workflow')
          await applyFlowchartToWorkflow()
          // console.log('[VIBE] Mermaid flowchart applied successfully')
        }
      }
    }
    catch (error: unknown) {
      // Handle API errors (e.g., network errors, server errors)
      const { setIsVibeGenerating } = workflowStore.getState()
      setIsVibeGenerating(false)

      // Extract error message from Response object or Error
      let errorMessage = t('vibe.generateError')
      if (error instanceof Response) {
        try {
          const errorData = await error.json()
          errorMessage = errorData?.message || errorMessage
        }
        catch {
          // If we can't parse the response, use the default error message
        }
      }
      else if (error instanceof Error) {
        errorMessage = error.message || errorMessage
      }

      Toast.notify({ type: 'error', message: errorMessage })
      workflowStore.setState(state => ({
        ...state,
        vibePanelMessage: `${errorMessage} ${t('vibe.regenerateReminder')}`,
        isVibeGenerating: false,
      }))
    }
    finally {
      isGeneratingRef.current = false
    }
  }, [
    availableNodesList,
    toolOptions,
    language,
    getLatestModelConfig,
    modelList,
    applyBackendNodesToWorkflow,
    applyFlowchartToWorkflow,
    createGraphFromBackendNodes,
    flowchartToWorkflowGraph,
    getNodesReadOnly,
    workflowStore,
    t,
  ])

  return {
    handleVibeCommand,
    isGeneratingRef,
    lastInstructionRef,
  }
}
