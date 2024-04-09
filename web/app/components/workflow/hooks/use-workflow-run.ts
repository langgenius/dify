import { useCallback } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import produce from 'immer'
import { useWorkflowStore } from '../store'
import {
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '../types'
import { useWorkflow } from './use-workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IOtherOptions } from '@/service/base'
import { ssePost } from '@/service/base'
import {
  fetchPublishedWorkflow,
  stopWorkflowRun,
} from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'

export const useWorkflowRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const featuresStore = useFeaturesStore()
  const { renderTreeFromRecord } = useWorkflow()

  const handleBackupDraft = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactflow
    const {
      backupDraft,
      setBackupDraft,
    } = workflowStore.getState()
    const { features } = featuresStore!.getState()

    if (!backupDraft) {
      setBackupDraft({
        nodes: getNodes(),
        edges,
        viewport: getViewport(),
        features,
      })
    }
  }, [reactflow, workflowStore, store, featuresStore])

  const handleLoadBackupDraft = useCallback(() => {
    const {
      setNodes,
      setEdges,
    } = store.getState()
    const { setViewport } = reactflow
    const {
      backupDraft,
      setBackupDraft,
    } = workflowStore.getState()

    if (backupDraft) {
      const {
        nodes,
        edges,
        viewport,
        features,
      } = backupDraft
      setNodes(nodes)
      setEdges(edges)
      setViewport(viewport)
      featuresStore!.setState({ features })
      setBackupDraft(undefined)
    }
  }, [store, reactflow, workflowStore, featuresStore])

  const handleRunSetting = useCallback((shouldClear?: boolean) => {
    if (shouldClear) {
      workflowStore.setState({
        workflowRunningData: undefined,
        historyWorkflowData: undefined,
        showInputsPanel: false,
      })
    }
    else {
      workflowStore.setState({
        workflowRunningData: {
          result: {
            status: shouldClear ? '' : WorkflowRunningStatus.Waiting,
          },
          tracing: [],
        },
      })
    }

    const {
      setNodes,
      getNodes,
      edges,
      setEdges,
    } = store.getState()

    if (shouldClear) {
      handleLoadBackupDraft()
    }
    else {
      handleBackupDraft()
      const newNodes = produce(getNodes(), (draft) => {
        draft.forEach((node) => {
          node.data._runningStatus = NodeRunningStatus.Waiting
        })
      })
      setNodes(newNodes)
      const newEdges = produce(edges, (draft) => {
        draft.forEach((edge) => {
          edge.data._runned = false
        })
      })
      setEdges(newEdges)
    }
  }, [store, handleLoadBackupDraft, handleBackupDraft, workflowStore])

  const handleRun = useCallback((
    params: any,
    callback?: IOtherOptions,
  ) => {
    const {
      onWorkflowStarted,
      onWorkflowFinished,
      onNodeStarted,
      onNodeFinished,
      onError,
      ...restCallback
    } = callback || {}
    workflowStore.setState({ historyWorkflowData: undefined })
    const appDetail = useAppStore.getState().appDetail
    const workflowContainer = document.getElementById('workflow-container')

    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    let url = ''
    if (appDetail?.mode === 'advanced-chat')
      url = `/apps/${appDetail.id}/advanced-chat/workflows/draft/run`

    if (appDetail?.mode === 'workflow')
      url = `/apps/${appDetail.id}/workflows/draft/run`

    let prevNodeId = ''

    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.result = {
        ...draft?.result,
        status: WorkflowRunningStatus.Running,
      }
    }))

    ssePost(
      url,
      {
        body: params,
      },
      {
        onWorkflowStarted: (params) => {
          const { task_id, data } = params
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()
          const {
            getNodes,
            setNodes,
            edges,
            setEdges,
          } = store.getState()
          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.task_id = task_id
            draft.result = {
              ...draft?.result,
              ...data,
              status: WorkflowRunningStatus.Running,
            }
          }))

          const newNodes = produce(getNodes(), (draft) => {
            draft.forEach((node) => {
              node.data._runningStatus = NodeRunningStatus.Waiting
            })
          })
          setNodes(newNodes)
          const newEdges = produce(edges, (draft) => {
            draft.forEach((edge) => {
              edge.data = {
                ...edge.data,
                _runned: false,
              }
            })
          })
          setEdges(newEdges)

          if (onWorkflowStarted)
            onWorkflowStarted(params)
        },
        onWorkflowFinished: (params) => {
          const { data } = params
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()

          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.result = {
              ...draft.result,
              ...data,
            }
          }))

          prevNodeId = ''

          if (onWorkflowFinished)
            onWorkflowFinished(params)
        },
        onError: (params) => {
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()

          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.result = {
              ...draft.result,
              status: WorkflowRunningStatus.Failed,
            }
          }))

          if (onError)
            onError(params)
        },
        onNodeStarted: (params) => {
          const { data } = params
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()
          const {
            getNodes,
            setNodes,
            edges,
            setEdges,
          } = store.getState()
          const nodes = getNodes()
          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.tracing!.push({
              ...data,
              status: NodeRunningStatus.Running,
            } as any)
          }))

          const {
            setViewport,
          } = reactflow
          const currentNodeIndex = nodes.findIndex(node => node.id === data.node_id)
          const currentNode = nodes[currentNodeIndex]
          const position = currentNode.position
          const zoom = 1

          setViewport({
            x: (clientWidth - 400 - currentNode.width!) / 2 - position.x,
            y: (clientHeight - currentNode.height!) / 2 - position.y,
            zoom,
          })
          const newNodes = produce(nodes, (draft) => {
            draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Running
          })
          setNodes(newNodes)
          const newEdges = produce(edges, (draft) => {
            const edge = draft.find(edge => edge.target === data.node_id && edge.source === prevNodeId)

            if (edge)
              edge.data = { ...edge.data, _runned: true } as any
          })
          setEdges(newEdges)

          if (onNodeStarted)
            onNodeStarted(params)
        },
        onNodeFinished: (params) => {
          const { data } = params
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()
          const {
            getNodes,
            setNodes,
          } = store.getState()
          const nodes = getNodes()
          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            const currentIndex = draft.tracing!.findIndex(trace => trace.node_id === data.node_id)

            if (currentIndex > -1 && draft.tracing) {
              draft.tracing[currentIndex] = {
                ...(draft.tracing[currentIndex].extras
                  ? { extras: draft.tracing[currentIndex].extras }
                  : {}),
                ...data,
              } as any
            }
          }))

          const newNodes = produce(nodes, (draft) => {
            const currentNode = draft.find(node => node.id === data.node_id)!

            currentNode.data._runningStatus = data.status as any
          })
          setNodes(newNodes)

          prevNodeId = data.node_id

          if (onNodeFinished)
            onNodeFinished(params)
        },
        ...restCallback,
      },
    )
  }, [store, reactflow, workflowStore])

  const handleStopRun = useCallback((taskId: string) => {
    const appId = useAppStore.getState().appDetail?.id

    stopWorkflowRun(`/apps/${appId}/workflow-runs/tasks/${taskId}/stop`)
  }, [])

  const handleRestoreFromPublishedWorkflow = useCallback(async () => {
    const appDetail = useAppStore.getState().appDetail
    const publishedWorkflow = await fetchPublishedWorkflow(`/apps/${appDetail?.id}/workflows/publish`)

    if (publishedWorkflow) {
      const nodes = publishedWorkflow.graph.nodes
      const edges = publishedWorkflow.graph.edges
      const viewport = publishedWorkflow.graph.viewport

      renderTreeFromRecord(nodes, edges, viewport)
      featuresStore?.setState({ features: publishedWorkflow.features })
      workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
    }
  }, [featuresStore, workflowStore, renderTreeFromRecord])

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRunSetting,
    handleRun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}
