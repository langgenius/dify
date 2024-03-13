import {
  useCallback,
  useRef,
} from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import produce from 'immer'
import { useStore } from '../store'
import {
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '../types'
import { NODE_WIDTH } from '../constants'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IOtherOptions } from '@/service/base'
import { ssePost } from '@/service/base'

export const useWorkflowRun = () => {
  const store = useStoreApi()
  const reactflow = useReactFlow()
  const workflowContainerRef = useRef<HTMLDivElement>(null)

  const handleBackupDraft = useCallback(() => {
    const {
      getNodes,
      getEdges,
      getViewport,
    } = reactflow
    const {
      setBackupDraft,
    } = useStore.getState()

    setBackupDraft({
      nodes: getNodes(),
      edges: getEdges(),
      viewport: getViewport(),
    })
  }, [reactflow])

  const handleLoadBackupDraft = useCallback(() => {
    const {
      setNodes,
      setEdges,
    } = store.getState()
    const { setViewport } = reactflow
    const { backupDraft } = useStore.getState()

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
  }, [store, reactflow])

  const handleRunSetting = useCallback((shouldClear?: boolean) => {
    useStore.setState({ runningStatus: shouldClear ? undefined : WorkflowRunningStatus.Waiting })
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
          edge.data = { ...edge.data, _runned: false }
        })
      })
      setEdges(newEdges)
    }
  }, [store, handleLoadBackupDraft, handleBackupDraft])

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
        onWorkflowStarted: ({ task_id, workflow_run_id, sequence_number }) => {
          useStore.setState({ runningStatus: WorkflowRunningStatus.Running })
          useStore.setState({ taskId: task_id })
          useStore.setState({ currentSequenceNumber: sequence_number })
          useStore.setState({ workflowRunId: workflow_run_id })
          const newNodes = produce(getNodes(), (draft) => {
            draft.forEach((node) => {
              node.data._runningStatus = NodeRunningStatus.Waiting
            })
          })
          setNodes(newNodes)
        },
        onWorkflowFinished: ({ data }) => {
          useStore.setState({ runningStatus: data.status as WorkflowRunningStatus })
        },
        onNodeStarted: ({ data }) => {
          const nodes = getNodes()
          const {
            getViewport,
            setViewport,
          } = reactflow

          const viewport = getViewport()
          const currentNodeIndex = nodes.findIndex(node => node.id === data.node_id)
          const currentNode = nodes[currentNodeIndex]
          const position = currentNode.position
          const zoom = 0.5
          setViewport({
            zoom,
            x: (((clientWidth - 400) / 2 - NODE_WIDTH / 2) / viewport.zoom - position.x) * zoom,
            y: ((clientHeight / 2 - currentNode.height! / 2) / viewport.zoom - position.y) * zoom,
          })
          const newNodes = produce(nodes, (draft) => {
            draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Running
          })
          setNodes(newNodes)
          const newEdges = produce(edges, (draft) => {
            const edge = draft.find(edge => edge.target === data.node_id)

            if (edge)
              edge.data = { ...edge.data, _runned: true }
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
  }, [store, reactflow])

  return {
    handleBackupDraft,
    handleRunSetting,
    handleRun,
    workflowContainerRef,
  }
}
