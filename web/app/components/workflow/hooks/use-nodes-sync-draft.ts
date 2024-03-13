import { useCallback } from 'react'
import produce from 'immer'
import { useDebounceFn } from 'ahooks'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import { useStore } from '../store'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { useStore as useAppStore } from '@/app/components/app/store'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const reactFlow = useReactFlow()
  const featuresStore = useFeaturesStore()

  const shouldDebouncedSyncWorkflowDraft = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactFlow
    const appId = useAppStore.getState().appDetail?.id

    if (appId) {
      const features = featuresStore!.getState().features
      const producedNodes = produce(getNodes(), (draft) => {
        draft.forEach((node) => {
          Object.keys(node.data).forEach((key) => {
            if (key.startsWith('_'))
              delete node.data[key]
          })
        })
      })
      const producedEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          delete edge.data
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
            opening_statement: features.opening.opening_statement,
            suggested_questions: features.opening.suggested_questions,
            suggested_questions_after_answer: features.suggested,
            text_to_speech: features.text2speech,
            speech_to_text: features.speech2text,
            retriever_resource: features.citation,
            sensitive_word_avoidance: features.moderation,
          },
        },
      }).then((res) => {
        useStore.setState({ draftUpdatedAt: res.updated_at })
      })
    }
  }, [store, reactFlow, featuresStore])

  const { run: debouncedSyncWorkflowDraft } = useDebounceFn(shouldDebouncedSyncWorkflowDraft, {
    wait: 2000,
    trailing: true,
  })

  const handleSyncWorkflowDraft = useCallback((shouldDelay?: boolean) => {
    const { runningStatus } = useStore.getState()

    if (runningStatus)
      return

    if (shouldDelay)
      debouncedSyncWorkflowDraft()
    else
      shouldDebouncedSyncWorkflowDraft()
  }, [debouncedSyncWorkflowDraft, shouldDebouncedSyncWorkflowDraft])

  return {
    handleSyncWorkflowDraft,
  }
}
