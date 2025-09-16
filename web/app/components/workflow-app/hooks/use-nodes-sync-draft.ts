import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import { useParams } from 'next/navigation'
import {
  useWorkflowStore,
} from '@/app/components/workflow/store'
import { BlockEnum, type EnvironmentVariable } from '@/app/components/workflow/types'
import {
  useNodesReadOnly,
} from '@/app/components/workflow/hooks/use-workflow'
import { syncWorkflowDraft } from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { API_PREFIX } from '@/config'
import { useWorkflowRefreshDraft } from '.'

export const useNodesSyncDraft = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const featuresStore = useFeaturesStore()
  const { getNodesReadOnly } = useNodesReadOnly()
  const { handleRefreshWorkflowDraft } = useWorkflowRefreshDraft()
  const params = useParams()

  const getPostParams = useCallback((overrideEnv?: EnvironmentVariable[]) => {
    const {
      getNodes,
      edges,
      transform,
    } = store.getState()
    const [x, y, zoom] = transform
    const {
      appId,
      conversationVariables,
      environmentVariables: environmentVariablesFromStore,
      syncWorkflowDraftHash,
      restoredSecretsInfo,
    } = workflowStore.getState()

    const environmentVariables = overrideEnv || environmentVariablesFromStore

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
      const producedEdges = produce(edges.filter(edge => !edge.data?._isTemp), (draft) => {
        draft.forEach((edge) => {
          Object.keys(edge.data).forEach((key) => {
            if (key.startsWith('_'))
              delete edge.data[key]
          })
        })
      })
      return {
        url: `/apps/${appId}/workflows/draft`,
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
            opening_statement: features.opening?.enabled ? (features.opening?.opening_statement || '') : '',
            suggested_questions: features.opening?.enabled ? (features.opening?.suggested_questions || []) : [],
            suggested_questions_after_answer: features.suggested,
            text_to_speech: features.text2speech,
            speech_to_text: features.speech2text,
            retriever_resource: features.citation,
            sensitive_word_avoidance: features.moderation,
            file_upload: features.file,
          },
          environment_variables: environmentVariables.map((item: EnvironmentVariable) => {
            // If it's a restored secret, send the from_version field
            if (item.value_type === 'secret' && restoredSecretsInfo[item.id]) {
              return {
                id: item.id,
                name: item.name,
                value_type: item.value_type,
                from_version: restoredSecretsInfo[item.id].from_version,
                // value and description are required by type but not used by backend for restored secrets
                value: '',
                description: '',
              }
            }
            // For all other cases, pass the value as is.
            // For secrets, this will be the plaintext value during the save operation.
            return item
          }),
          conversation_variables: conversationVariables,
          hash: syncWorkflowDraftHash,
        },
      }
    }
  }, [store, featuresStore, workflowStore])

  const syncWorkflowDraftWhenPageClose = useCallback(() => {
    if (getNodesReadOnly())
      return
    const postParams = getPostParams()

    if (postParams) {
      navigator.sendBeacon(
        `${API_PREFIX}/apps/${params.appId}/workflows/draft?_token=${localStorage.getItem('console_token')}`,
        JSON.stringify(postParams.params),
      )
    }
  }, [getPostParams, params.appId, getNodesReadOnly])

  const doSyncWorkflowDraft = useCallback(async (
    notRefreshWhenSyncError?: boolean,
    callback?: {
      onSuccess?: () => void
      onError?: () => void
      onSettled?: () => void
    },
    overrideEnv?: EnvironmentVariable[],
  ) => {
    if (getNodesReadOnly())
      return
    const postParams = getPostParams(overrideEnv)

    if (postParams) {
      const {
        setSyncWorkflowDraftHash,
        setDraftUpdatedAt,
      } = workflowStore.getState()
      try {
        const res = await syncWorkflowDraft(postParams)
        setSyncWorkflowDraftHash(res.hash)
        setDraftUpdatedAt(res.updated_at)
        callback?.onSuccess && callback.onSuccess()
      }
      catch (error: any) {
        if (error && error.json && !error.bodyUsed) {
          error.json().then((err: any) => {
            if (err.code === 'draft_workflow_not_sync' && !notRefreshWhenSyncError)
              handleRefreshWorkflowDraft()
          })
        }
        callback?.onError && callback.onError()
      }
      finally {
        callback?.onSettled && callback.onSettled()
      }
    }
  }, [workflowStore, getPostParams, getNodesReadOnly, handleRefreshWorkflowDraft])

  return {
    doSyncWorkflowDraft,
    syncWorkflowDraftWhenPageClose,
  }
}
