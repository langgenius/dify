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
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IOtherOptions } from '@/service/base'
import { ssePost } from '@/service/base'
import { stopWorkflowRun } from '@/service/workflow'

export const useWorkflowRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()

  const handleBackupDraft = useCallback(() => {
    const {
      getNodes,
      getEdges,
      getViewport,
    } = reactflow
    const {
      setBackupDraft,
    } = workflowStore.getState()

    setBackupDraft({
      nodes: getNodes(),
      edges: getEdges(),
      viewport: getViewport(),
    })
  }, [reactflow, workflowStore])

  const handleLoadBackupDraft = useCallback(() => {
    const {
      setNodes,
      setEdges,
    } = store.getState()
    const { setViewport } = reactflow
    const { backupDraft } = workflowStore.getState()

    if (backupDraft) {
      const {
        nodes,
        edges,
        viewport,
      } = backupDraft
      setNodes(nodes)
      setEdges(edges)
      setViewport(viewport)
    }
  }, [store, reactflow, workflowStore])

  const handleRunSetting = useCallback((shouldClear?: boolean) => {
    workflowStore.setState({ runningStatus: shouldClear ? undefined : WorkflowRunningStatus.Waiting })
    workflowStore.setState({ taskId: '' })
    workflowStore.setState({ currentSequenceNumber: 0 })
    workflowStore.setState({ workflowRunId: '' })
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

  const handleRun = useCallback((params: any, callback?: IOtherOptions) => {
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
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

    ssePost(
      url,
      {
        body: params,
      },
      {
        onWorkflowStarted: ({ task_id, workflow_run_id, data }) => {
          workflowStore.setState({ runningStatus: WorkflowRunningStatus.Running })
          workflowStore.setState({ taskId: task_id })
          workflowStore.setState({ currentSequenceNumber: data.sequence_number })
          workflowStore.setState({ workflowRunId: workflow_run_id })
          const newNodes = produce(getNodes(), (draft) => {
            draft.forEach((node) => {
              node.data._runningStatus = NodeRunningStatus.Waiting
            })
          })
          setNodes(newNodes)
        },
        onWorkflowFinished: ({ data }) => {
          workflowStore.setState({ runningStatus: data.status as WorkflowRunningStatus })
        },
        onNodeStarted: ({ data }) => {
          const nodes = getNodes()
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
            const edge = draft.find(edge => edge.target === data.node_id)

            if (edge)
              edge.data._runned = true
          })
          setEdges(newEdges)
        },
        onNodeFinished: ({ data }) => {
          const newNodes = produce(getNodes(), (draft) => {
            const currentNode = draft.find(node => node.id === data.node_id)!

            currentNode.data._runningStatus = data.status
          })
          setNodes(newNodes)
        },
        ...callback,
      },
    )
  }, [store, reactflow, workflowStore])

  const handleStopRun = useCallback(() => {
    const appId = useAppStore.getState().appDetail?.id
    const taskId = workflowStore.getState().taskId

    stopWorkflowRun(`/apps/${appId}/workflow-runs/tasks/${taskId}/stop`)
  }, [workflowStore])

  return {
    handleBackupDraft,
    handleRunSetting,
    handleRun,
    handleStopRun,
  }
}
