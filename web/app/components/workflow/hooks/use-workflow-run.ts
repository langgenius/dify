import { useCallback } from 'react'
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
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IOtherOptions } from '@/service/base'
import { ssePost } from '@/service/base'

export const useWorkflowRun = () => {
  const store = useStoreApi()
  const reactflow = useReactFlow()

  const handleRunSetting = useCallback((shouldClear?: boolean) => {
    useStore.setState({ runningStatus: shouldClear ? undefined : WorkflowRunningStatus.Waiting })
    const { setNodes, getNodes } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        node.data._runningStatus = shouldClear ? undefined : NodeRunningStatus.Waiting
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleRun = useCallback((params: any, callback?: IOtherOptions) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const appDetail = useAppStore.getState().appDetail

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
          const position = nodes[currentNodeIndex].position
          const zoom = 1
          setViewport({
            zoom,
            x: 200 / viewport.zoom - position.x,
            y: 200 / viewport.zoom - position.y,
          })
          const newNodes = produce(nodes, (draft) => {
            draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Running
          })
          setNodes(newNodes)
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
    handleRunSetting,
    handleRun,
  }
}
