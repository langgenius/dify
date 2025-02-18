import {
  useMemo,
  useState,
} from 'react'
import {
  RiArrowRightSLine,
  RiListView,
} from '@remixicon/react'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import type { AgentLogItemWithChildren } from '@/types/workflow'
import NodeStatusIcon from '@/app/components/workflow/nodes/_base/components/node-status-icon'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'

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
    <div className='bg-background-default border-components-panel-border rounded-[10px] border-[0.5px]'>
      <div
        className={cn(
          'flex cursor-pointer items-center pb-2 pl-1.5 pr-3 pt-2',
          expanded && 'pb-1',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {
          expanded
            ? <RiArrowRightSLine className='text-text-quaternary h-4 w-4 shrink-0 rotate-90' />
            : <RiArrowRightSLine className='text-text-quaternary h-4 w-4 shrink-0' />
        }
        <BlockIcon
          className='mr-1.5 shrink-0'
          type={toolIcon ? BlockEnum.Tool : BlockEnum.Agent}
          toolIcon={toolIcon}
        />
        <div
          className='system-sm-semibold-uppercase text-text-secondary grow truncate'
          title={label}
        >
          {label}
        </div>
        {
          metadata?.elapsed_time && (
            <div className='system-xs-regular text-text-tertiary mr-2 shrink-0'>{metadata?.elapsed_time?.toFixed(3)}s</div>
          )
        }
        <NodeStatusIcon status={mergeStatus} />
      </div>
      {
        expanded && (
          <div className='p-1 pt-0'>
            {
              !!children?.length && (
                <Button
                  className='mb-1 flex w-full items-center justify-between'
                  variant='tertiary'
                  onClick={() => onShowAgentOrToolLog(item)}
                >
                  <div className='flex items-center'>
                    <RiListView className='text-components-button-tertiary-text mr-1 h-4 w-4 shrink-0' />
                    {`${children.length} Action Logs`}
                  </div>
                  <div className='flex'>
                    <RiArrowRightSLine className='text-components-button-tertiary-text h-4 w-4 shrink-0' />
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
