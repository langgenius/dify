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
    <div className='bg-background-default border-[0.5px] border-components-panel-border rounded-[10px]'>
      <div
        className={cn(
          'flex items-center pl-1.5 pt-2 pr-3 pb-2 cursor-pointer',
          expanded && 'pb-1',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {
          expanded
            ? <RiArrowRightSLine className='shrink-0 w-4 h-4 rotate-90 text-text-quaternary' />
            : <RiArrowRightSLine className='shrink-0 w-4 h-4 text-text-quaternary' />
        }
        <BlockIcon
          className='shrink-0 mr-1.5'
          type={toolIcon ? BlockEnum.Tool : BlockEnum.Agent}
          toolIcon={toolIcon}
        />
        <div
          className='grow system-sm-semibold-uppercase text-text-secondary truncate'
          title={label}
        >
          {label}
        </div>
        {
          metadata?.elapsed_time && (
            <div className='shrink-0 mr-2 system-xs-regular text-text-tertiary'>{metadata?.elapsed_time?.toFixed(3)}s</div>
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
                  className='flex items-center justify-between mb-1 w-full'
                  variant='tertiary'
                  onClick={() => onShowAgentOrToolLog(item)}
                >
                  <div className='flex items-center'>
                    <RiListView className='mr-1 w-4 h-4 text-components-button-tertiary-text shrink-0' />
                    {`${children.length} Action Logs`}
                  </div>
                  <div className='flex'>
                    <RiArrowRightSLine className='w-4 h-4 text-components-button-tertiary-text shrink-0' />
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
