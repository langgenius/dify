import { useCallback } from 'react'
import produce from 'immer'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import { BlockEnum } from '../types'
import { useNodesReadOnly } from './use-workflow'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useStore as useAppStore } from '@/app/components/app/store'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactFlow = useReactFlow()
  const featuresStore = useFeaturesStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const debouncedSyncWorkflowDraft = useStore(s => s.debouncedSyncWorkflowDraft)

  const doSyncWorkflowDraft = useCallback(async () => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactFlow
    const appId = useAppStore.getState().appDetail?.id

    if (appId) {
      const nodes = getNodes()
      const hasStartNode = nodes.find(node => node.data.type === BlockEnum.Start)

      if (!hasStartNode)
        return

      const features = featuresStore!.getState().features
      const producedNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_'))
              delete node.data[key]
          })
        })
      })
      const producedEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          Object.keys(edge.data).forEach((key) => {
            if (key.startsWith('_'))
              delete edge.data[key]
          })
        })
      })
      syncWorkflowDraft({
        url: `/apps/${appId}/workflows/draft`,
        params: {
          graph: {
            nodes: producedNodes,
            edges: producedEdges,
            viewport: getViewport(),
          },
          features: {
            opening_statement: features.opening?.opening_statement || '',
            suggested_questions: features.opening?.suggested_questions || [],
            suggested_questions_after_answer: features.suggested,
            text_to_speech: features.text2speech,
            speech_to_text: features.speech2text,
            retriever_resource: features.citation,
            sensitive_word_avoidance: features.moderation,
            file_upload: features.file,
          },
        },
      }).then((res) => {
        workflowStore.getState().setDraftUpdatedAt(res.updated_at)
      })
    }
  }, [store, reactFlow, featuresStore, workflowStore])

  const handleSyncWorkflowDraft = useCallback((sync?: boolean) => {
    if (getNodesReadOnly())
      return

    if (sync)
      doSyncWorkflowDraft()
    else
      debouncedSyncWorkflowDraft(doSyncWorkflowDraft)
  }, [debouncedSyncWorkflowDraft, doSyncWorkflowDraft, getNodesReadOnly])

  return {
    doSyncWorkflowDraft,
    handleSyncWorkflowDraft,
  }
}
