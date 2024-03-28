import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { useParams } from 'next/navigation'
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
  const featuresStore = useFeaturesStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const debouncedSyncWorkflowDraft = useStore(s => s.debouncedSyncWorkflowDraft)
  const params = useParams()

  const doSyncWorkflowDraft = useCallback(async () => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const [x, y, zoom] = transform
    const appId = useAppStore.getState().appDetail?.id

    if (appId || params.appId) {
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
        url: `/apps/${appId || params.appId}/workflows/draft`,
        params: {
          graph: {
            nodes: producedNodes,
            edges: producedEdges,
            viewport: {
              x,
              y,
              zoom,
            },
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
  }, [store, featuresStore, workflowStore, params.appId])

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
