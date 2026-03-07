import type { AgentLogItemWithChildren } from '@/types/workflow'
import {
  RiArrowRightSLine,
  RiListView,
} from '@remixicon/react'
import {
  useMemo,
  useState,
} from 'react'
import Button from '@/app/components/base/button'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import BlockIcon from '@/app/components/workflow/block-icon'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import NodeStatusIcon from '@/app/components/workflow/nodes/_base/components/node-status-icon'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

type AgentLogItemProps = {
  item: AgentLogItemWithChildren
  onShowAgentOrToolLog: (detail: AgentLogItemWithChildren) => void
}
const AgentLogItem = ({
  item,
  onShowAgentOrToolLog,
}: AgentLogItemProps) => {
  const {
    label,
    status,
    children,
    data,
    metadata,
  } = item
  const [expanded, setExpanded] = useState(false)
  const { getIconUrl } = useGetIcon()
  const toolIcon = useMemo(() => {
    const icon = metadata?.icon

    if (icon) {
      if (icon.includes('http'))
        return icon

      return getIconUrl(icon)
    }

    return ''
  }, [getIconUrl, metadata?.icon])

  const mergeStatus = useMemo(() => {
    if (status === 'start')
      return 'running'

    return status
  }, [status])

  return (
    <div className="rounded-[10px] border-[0.5px] border-components-panel-border bg-background-default">
      <div
        className={cn(
          'flex cursor-pointer items-center pb-2 pl-1.5 pr-3 pt-2',
          expanded && 'pb-1',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {
          expanded
            ? <RiArrowRightSLine className="h-4 w-4 shrink-0 rotate-90 text-text-quaternary" />
            : <RiArrowRightSLine className="h-4 w-4 shrink-0 text-text-quaternary" />
        }
        <BlockIcon
          className="mr-1.5 shrink-0"
          type={toolIcon ? BlockEnum.Tool : BlockEnum.Agent}
          toolIcon={toolIcon}
        />
        <div
          className="system-sm-semibold-uppercase grow truncate text-text-secondary"
          title={label}
        >
          {label}
        </div>
        {
          !!metadata?.elapsed_time && (
            <div className="system-xs-regular mr-2 shrink-0 text-text-tertiary">
              {metadata?.elapsed_time?.toFixed(3)}
              s
            </div>
          )
        }
        <NodeStatusIcon status={mergeStatus} />
      </div>
      {
        expanded && (
          <div className="p-1 pt-0">
            {
              !!children?.length && (
                <Button
                  className="mb-1 flex w-full items-center justify-between"
                  variant="tertiary"
                  onClick={() => onShowAgentOrToolLog(item)}
                >
                  <div className="flex items-center">
                    <RiListView className="mr-1 h-4 w-4 shrink-0 text-components-button-tertiary-text" />
                    {`${children.length} Action Logs`}
                  </div>
                  <div className="flex">
                    <RiArrowRightSLine className="h-4 w-4 shrink-0 text-components-button-tertiary-text" />
                  </div>
                </Button>
              )
            }
            {
              data && (
                <CodeEditor
                  readOnly
                  title={<div>{'data'.toLocaleUpperCase()}</div>}
                  language={CodeLanguage.json}
                  value={data}
                  isJSONStringifyBeauty
                />
              )
            }
          </div>
        )
      }
    </div>
  )
}

export default AgentLogItem
