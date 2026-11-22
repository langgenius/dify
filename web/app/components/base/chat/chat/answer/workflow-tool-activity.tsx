import type { FC } from 'react'
import type { ChatItem } from '../../types'
import type { ToolActivity } from './tool-activity-item'
import { memo } from 'react'
import { SHELL_TOOL_NAMES, ToolActivityItem } from './tool-activity-item'

type WorkflowToolActivityProps = {
  item: ChatItem
  responding?: boolean
}

const WorkflowToolActivity: FC<WorkflowToolActivityProps> = ({ item, responding }) => {
  const activities = item.workflowAgentActivities
  if (!activities?.length) return null

  const groups = new Map<string, { title: string; tools: ToolActivity[] }>()
  for (const activity of activities) {
    let group = groups.get(activity.node_execution_id)
    if (!group) {
      group = {
        title: activity.data.node_title || activity.node_id,
        tools: [],
      }
      groups.set(activity.node_execution_id, group)
    }
    const active = activity.status === 'started' || activity.status === 'running'
    const finished = !active || !responding
    const status =
      activity.status === 'failed' || activity.status === 'cancelled'
        ? activity.status
        : active && !responding
          ? 'interrupted'
          : activity.status
    group.tools.push({
      kind: SHELL_TOOL_NAMES.has(activity.data.tool_name) ? 'shell' : 'tool',
      key: activity.id,
      name: activity.data.tool_name,
      label: activity.label || activity.data.tool_name,
      input: activity.data.tool_input,
      output: activity.data.tool_output,
      isFinished: finished,
      status,
      error: activity.error,
    })
  }

  return (
    <div
      className="flex w-full max-w-full min-w-0 flex-col gap-1"
      data-testid="workflow-tool-activity"
    >
      {[...groups.entries()].map(([executionId, group]) => (
        <div key={executionId} className="flex w-full max-w-full min-w-0 flex-col">
          <div className="px-1 system-xs-medium text-text-tertiary">{group.title}</div>
          {group.tools.map((tool) => (
            <ToolActivityItem key={tool.key} tool={tool} />
          ))}
        </div>
      ))}
    </div>
  )
}

export default memo(WorkflowToolActivity)
