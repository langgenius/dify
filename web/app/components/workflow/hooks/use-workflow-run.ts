import { useCallback } from 'react'
import {
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import produce from 'immer'
import { v4 as uuidV4 } from 'uuid'
import { usePathname } from 'next/navigation'
import { useWorkflowStore } from '../store'
import { useNodesSyncDraft } from '../hooks'
import {
  NodeRunningStatus,
  WorkflowRunningStatus,
} from '../types'
import { useWorkflowUpdate } from './use-workflow-interactions'
import { useStore as useAppStore } from '@/app/components/app/store'
import type { IOtherOptions } from '@/service/base'
import { ssePost } from '@/service/base'
import {
  fetchPublishedWorkflow,
  stopWorkflowRun,
} from '@/service/workflow'
import { useFeaturesStore } from '@/app/components/base/features/hooks'
import { AudioPlayerManager } from '@/app/components/base/audio-btn/audio.player.manager'

export const useWorkflowRun = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const reactflow = useReactFlow()
  const featuresStore = useFeaturesStore()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const { handleUpdateWorkflowCanvas } = useWorkflowUpdate()
  const pathname = usePathname()

  const handleBackupDraft = useCallback(() => {
    const {
      getNodes,
      edges,
    } = store.getState()
    const { getViewport } = reactflow
    const {
      backupDraft,
      setBackupDraft,
      environmentVariables,
    } = workflowStore.getState()
    const { features } = featuresStore!.getState()

    if (!backupDraft) {
      setBackupDraft({
        nodes: getNodes(),
        edges,
        viewport: getViewport(),
        features,
        environmentVariables,
      })
      doSyncWorkflowDraft()
    }
  }, [reactflow, workflowStore, store, featuresStore, doSyncWorkflowDraft])

  const handleLoadBackupDraft = useCallback(() => {
    const {
      backupDraft,
      setBackupDraft,
      setEnvironmentVariables,
    } = workflowStore.getState()

    if (backupDraft) {
      const {
        nodes,
        edges,
        viewport,
        features,
        environmentVariables,
      } = backupDraft
      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })
      setEnvironmentVariables(environmentVariables)
      featuresStore!.setState({ features })
      setBackupDraft(undefined)
    }
  }, [handleUpdateWorkflowCanvas, workflowStore, featuresStore])

  const handleRun = useCallback(async (
    params: any,
    callback?: IOtherOptions,
  ) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()
    const newNodes = produce(getNodes(), (draft) => {
      draft.forEach((node) => {
        node.data.selected = false
        node.data._runningStatus = undefined
      })
    })
    setNodes(newNodes)
    await doSyncWorkflowDraft()

    const {
      onWorkflowStarted,
      onWorkflowFinished,
      onNodeStarted,
      onNodeFinished,
      onIterationStart,
      onIterationNext,
      onIterationFinish,
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
      setWorkflowRunningData,
    } = workflowStore.getState()
    setWorkflowRunningData({
      result: {
        status: WorkflowRunningStatus.Running,
      },
      tracing: [],
      resultText: '',
    })

    let isInIteration = false
    let iterationLength = 0

    let ttsUrl = ''
    let ttsIsPublic = false
    if (params.token) {
      ttsUrl = '/text-to-audio'
      ttsIsPublic = true
    }
    else if (params.appId) {
      if (pathname.search('explore/installed') > -1)
        ttsUrl = `/installed-apps/${params.appId}/text-to-audio`
      else
        ttsUrl = `/apps/${params.appId}/text-to-audio`
    }
    const player = AudioPlayerManager.getInstance().getAudioPlayer(ttsUrl, ttsIsPublic, uuidV4(), 'none', 'none', (_: any): any => {})

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

          const isStringOutput = data.outputs && Object.keys(data.outputs).length === 1 && typeof data.outputs[Object.keys(data.outputs)[0]] === 'string'

          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.result = {
              ...draft.result,
              ...data,
            } as any
            if (isStringOutput) {
              draft.resultTabActive = true
              draft.resultText = data.outputs[Object.keys(data.outputs)[0]]
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
            transform,
          } = store.getState()
          if (isInIteration) {
            setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
              const tracing = draft.tracing!
              const iterations = tracing[tracing.length - 1]
              const currIteration = iterations.details![iterations.details!.length - 1]
              currIteration.push({
                ...data,
                status: NodeRunningStatus.Running,
              } as any)
            }))
          }
          else {
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
            const zoom = transform[2]

            if (!currentNode.parentId) {
              setViewport({
                x: (clientWidth - 400 - currentNode.width! * zoom) / 2 - position.x * zoom,
                y: (clientHeight - currentNode.height! * zoom) / 2 - position.y * zoom,
                zoom: transform[2],
              })
            }
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
          }
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
          if (isInIteration) {
            setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
              const tracing = draft.tracing!
              const iterations = tracing[tracing.length - 1]
              const currIteration = iterations.details![iterations.details!.length - 1]
              const nodeInfo = currIteration[currIteration.length - 1]

              currIteration[currIteration.length - 1] = {
                ...nodeInfo,
                ...data,
                status: NodeRunningStatus.Succeeded,
              } as any
            }))
          }
          else {
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
          }
          if (onNodeFinished)
            onNodeFinished(params)
        },
        onIterationStart: (params) => {
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
            transform,
          } = store.getState()
          const nodes = getNodes()
          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.tracing!.push({
              ...data,
              status: NodeRunningStatus.Running,
              details: [],
            } as any)
          }))
          isInIteration = true
          iterationLength = data.metadata.iterator_length

          const {
            setViewport,
          } = reactflow
          const currentNodeIndex = nodes.findIndex(node => node.id === data.node_id)
          const currentNode = nodes[currentNodeIndex]
          const position = currentNode.position
          const zoom = transform[2]

          if (!currentNode.parentId) {
            setViewport({
              x: (clientWidth - 400 - currentNode.width! * zoom) / 2 - position.x * zoom,
              y: (clientHeight - currentNode.height! * zoom) / 2 - position.y * zoom,
              zoom: transform[2],
            })
          }
          const newNodes = produce(nodes, (draft) => {
            draft[currentNodeIndex].data._runningStatus = NodeRunningStatus.Running
            draft[currentNodeIndex].data._iterationLength = data.metadata.iterator_length
          })
          setNodes(newNodes)
          const newEdges = produce(edges, (draft) => {
            const edge = draft.find(edge => edge.target === data.node_id && edge.source === prevNodeId)

            if (edge)
              edge.data = { ...edge.data, _runned: true } as any
          })
          setEdges(newEdges)

          if (onIterationStart)
            onIterationStart(params)
        },
        onIterationNext: (params) => {
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()

          const { data } = params
          const {
            getNodes,
            setNodes,
          } = store.getState()

          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            const iteration = draft.tracing![draft.tracing!.length - 1]
            if (iteration.details!.length >= iterationLength)
              return

            iteration.details!.push([])
          }))

          const nodes = getNodes()
          const newNodes = produce(nodes, (draft) => {
            const currentNode = draft.find(node => node.id === data.node_id)!

            currentNode.data._iterationIndex = data.index > 0 ? data.index : 1
          })
          setNodes(newNodes)

          if (onIterationNext)
            onIterationNext(params)
        },
        onIterationFinish: (params) => {
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
            const tracing = draft.tracing!
            tracing[tracing.length - 1] = {
              ...tracing[tracing.length - 1],
              ...data,
              status: NodeRunningStatus.Succeeded,
            } as any
          }))
          isInIteration = false

          const newNodes = produce(nodes, (draft) => {
            const currentNode = draft.find(node => node.id === data.node_id)!

            currentNode.data._runningStatus = data.status
          })
          setNodes(newNodes)

          prevNodeId = data.node_id

          if (onIterationFinish)
            onIterationFinish(params)
        },
        onTextChunk: (params) => {
          const { data: { text } } = params
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()
          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.resultTabActive = true
            draft.resultText += text
          }))
        },
        onTextReplace: (params) => {
          const { data: { text } } = params
          const {
            workflowRunningData,
            setWorkflowRunningData,
          } = workflowStore.getState()
          setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
            draft.resultText = text
          }))
        },
        onTTSChunk: (messageId: string, audio: string, audioType?: string) => {
          if (!audio || audio === '')
            return
          player.playAudioWithAudio(audio, true)
          AudioPlayerManager.getInstance().resetMsgId(messageId)
        },
        onTTSEnd: (messageId: string, audio: string, audioType?: string) => {
          player.playAudioWithAudio(audio, false)
        },
        ...restCallback,
      },
    )
  }, [store, reactflow, workflowStore, doSyncWorkflowDraft])

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
      const viewport = publishedWorkflow.graph.viewport!

      handleUpdateWorkflowCanvas({
        nodes,
        edges,
        viewport,
      })
      featuresStore?.setState({ features: publishedWorkflow.features })
      workflowStore.getState().setPublishedAt(publishedWorkflow.created_at)
      workflowStore.getState().setEnvironmentVariables(publishedWorkflow.environment_variables || [])
    }
  }, [featuresStore, handleUpdateWorkflowCanvas, workflowStore])

  return {
    handleBackupDraft,
    handleLoadBackupDraft,
    handleRun,
    handleStopRun,
    handleRestoreFromPublishedWorkflow,
  }
}
