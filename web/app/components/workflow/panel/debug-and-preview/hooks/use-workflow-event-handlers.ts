import type { UpdateCurrentQAParams } from './types'
import type { ChatItem } from '@/app/components/base/chat/types'
import type {
  AgentLogItem,
  HumanInputFilledFormData,
  HumanInputFormData,
  HumanInputFormTimeoutData,
  NodeTracing,
} from '@/types/workflow'
import { NodeRunningStatus, WorkflowRunningStatus } from '../../../types'

type WorkflowEventHandlersContext = {
  responseItem: ChatItem
  questionItem: ChatItem
  placeholderQuestionId: string
  parentMessageId?: string
  updateCurrentQAOnTree: (params: UpdateCurrentQAParams) => void
}

type TracingData = Partial<NodeTracing> & { id: string }
type AgentLogData = Partial<AgentLogItem> & { node_id: string, message_id: string }

export function createWorkflowEventHandlers(ctx: WorkflowEventHandlersContext) {
  const { responseItem, questionItem, placeholderQuestionId, parentMessageId, updateCurrentQAOnTree } = ctx

  const updateTree = () => {
    updateCurrentQAOnTree({
      placeholderQuestionId,
      questionItem,
      responseItem,
      parentId: parentMessageId,
    })
  }

  const updateTracingItem = (data: TracingData) => {
    const currentTracingIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.id === data.id)
    if (currentTracingIndex > -1) {
      responseItem.workflowProcess!.tracing[currentTracingIndex] = {
        ...responseItem.workflowProcess!.tracing[currentTracingIndex],
        ...data,
      }
      updateTree()
    }
  }

  return {
    onWorkflowStarted: ({ workflow_run_id, task_id }: { workflow_run_id: string, task_id: string }) => {
      responseItem.workflow_run_id = workflow_run_id
      responseItem.workflowProcess = {
        status: WorkflowRunningStatus.Running,
        tracing: [],
      }
      updateTree()
      return task_id
    },

    onWorkflowFinished: ({ data }: { data: { status: string } }) => {
      responseItem.workflowProcess!.status = data.status as WorkflowRunningStatus
      updateTree()
    },

    onIterationStart: ({ data }: { data: Partial<NodeTracing> }) => {
      responseItem.workflowProcess!.tracing!.push({
        ...data,
        status: NodeRunningStatus.Running,
      } as NodeTracing)
      updateTree()
    },

    onIterationFinish: ({ data }: { data: TracingData }) => {
      updateTracingItem(data)
    },

    onLoopStart: ({ data }: { data: Partial<NodeTracing> }) => {
      responseItem.workflowProcess!.tracing!.push({
        ...data,
        status: NodeRunningStatus.Running,
      } as NodeTracing)
      updateTree()
    },

    onLoopFinish: ({ data }: { data: TracingData }) => {
      updateTracingItem(data)
    },

    onNodeStarted: ({ data }: { data: Partial<NodeTracing> }) => {
      responseItem.workflowProcess!.tracing!.push({
        ...data,
        status: NodeRunningStatus.Running,
      } as NodeTracing)
      updateTree()
    },

    onNodeRetry: ({ data }: { data: NodeTracing }) => {
      responseItem.workflowProcess!.tracing!.push(data)
      updateTree()
    },

    onNodeFinished: ({ data }: { data: TracingData }) => {
      updateTracingItem(data)
    },

    onHumanInputRequired: ({ data }: { data: HumanInputFormData }) => {
      if (!responseItem.humanInputFormDataList) {
        responseItem.humanInputFormDataList = [data]
      }
      else {
        const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
        if (currentFormIndex > -1)
          responseItem.humanInputFormDataList[currentFormIndex] = data
        else
          responseItem.humanInputFormDataList.push(data)
      }

      const currentTracingIndex = responseItem.workflowProcess?.tracing?.findIndex(item => item.node_id === data.node_id) ?? -1
      if (currentTracingIndex > -1) {
        responseItem.workflowProcess!.tracing[currentTracingIndex].status = NodeRunningStatus.Paused
      }

      updateTree()
    },

    onHumanInputFormFilled: ({ data }: { data: HumanInputFilledFormData }) => {
      if (responseItem.humanInputFormDataList?.length) {
        const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
        if (currentFormIndex > -1)
          responseItem.humanInputFormDataList.splice(currentFormIndex, 1)
      }

      if (!responseItem.humanInputFilledFormDataList)
        responseItem.humanInputFilledFormDataList = [data]
      else
        responseItem.humanInputFilledFormDataList.push(data)

      updateTree()
    },

    onHumanInputFormTimeout: ({ data }: { data: HumanInputFormTimeoutData }) => {
      if (responseItem.humanInputFormDataList?.length) {
        const currentFormIndex = responseItem.humanInputFormDataList.findIndex(item => item.node_id === data.node_id)
        if (currentFormIndex > -1)
          responseItem.humanInputFormDataList[currentFormIndex].expiration_time = data.expiration_time
      }
      updateTree()
    },

    onWorkflowPaused: () => {
      if (responseItem.workflowProcess)
        responseItem.workflowProcess.status = WorkflowRunningStatus.Paused
      updateTree()
    },

    onAgentLog: ({ data }: { data: AgentLogData }) => {
      const currentNodeIndex = responseItem.workflowProcess!.tracing!.findIndex(item => item.node_id === data.node_id)
      if (currentNodeIndex > -1) {
        const current = responseItem.workflowProcess!.tracing![currentNodeIndex]

        if (current.execution_metadata) {
          if (current.execution_metadata.agent_log) {
            const currentLogIndex = current.execution_metadata.agent_log.findIndex(log => log.message_id === data.message_id)
            if (currentLogIndex > -1) {
              current.execution_metadata.agent_log[currentLogIndex] = {
                ...current.execution_metadata.agent_log[currentLogIndex],
                ...data,
              } as AgentLogItem
            }
            else {
              current.execution_metadata.agent_log.push(data as AgentLogItem)
            }
          }
          else {
            current.execution_metadata.agent_log = [data as AgentLogItem]
          }
        }
        else {
          current.execution_metadata = {
            agent_log: [data as AgentLogItem],
          } as NodeTracing['execution_metadata']
        }

        responseItem.workflowProcess!.tracing[currentNodeIndex] = {
          ...current,
        }

        updateTree()
      }
    },
  }
}
