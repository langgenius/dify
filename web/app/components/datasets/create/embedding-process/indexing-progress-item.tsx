import type { FC } from 'react'
import type { IndexingStatusResponse } from '@/models/datasets'
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
} from '@remixicon/react'
import NotionIcon from '@/app/components/base/notion-icon'
import Tooltip from '@/app/components/base/tooltip'
import PriorityLabel from '@/app/components/billing/priority-label'
import { DataSourceType } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import DocumentFileIcon from '../../common/document-file-icon'
import { getFileType, getSourcePercent, isSourceEmbedding } from './utils'

type IndexingProgressItemProps = {
  detail: IndexingStatusResponse
  name?: string
  sourceType?: DataSourceType
  notionIcon?: string
  enableBilling?: boolean
}

// Status icon component for completed/error states
const StatusIcon: FC<{ status: string, error?: string }> = ({ status, error }) => {
  if (status === 'completed')
    return <RiCheckboxCircleFill className="size-4 shrink-0 text-text-success" />

  if (status === 'error') {
    return (
      <Tooltip
        popupClassName="px-4 py-[14px] max-w-60 body-xs-regular text-text-secondary border-[0.5px] border-components-panel-border rounded-xl"
        offset={4}
        popupContent={error}
      >
        <span>
          <RiErrorWarningFill className="size-4 shrink-0 text-text-destructive" />
        </span>
      </Tooltip>
    )
  }

  return null
}

// Source type icon component
const SourceTypeIcon: FC<{
  sourceType?: DataSourceType
  name?: string
  notionIcon?: string
}> = ({ sourceType, name, notionIcon }) => {
  if (sourceType === DataSourceType.FILE) {
    return (
      <DocumentFileIcon
        size="sm"
        className="shrink-0"
        name={name}
        extension={getFileType(name)}
      />
    )
  }

  if (sourceType === DataSourceType.NOTION) {
    return (
      <NotionIcon
        className="shrink-0"
        type="page"
        src={notionIcon}
      />
    )
  }

  return null
}

const IndexingProgressItem: FC<IndexingProgressItemProps> = ({
  detail,
  name,
  sourceType,
  notionIcon,
  enableBilling,
}) => {
  const isEmbedding = isSourceEmbedding(detail)
  const percent = getSourcePercent(detail)
  const isError = detail.indexing_status === 'error'

  return (
    <div
      className={cn(
        'relative h-[26px] overflow-hidden rounded-md bg-components-progress-bar-bg',
        isError && 'bg-state-destructive-hover-alt',
      )}
    >
      {isEmbedding && (
        <div
          className="absolute left-0 top-0 h-full min-w-0.5 border-r-[2px] border-r-components-progress-bar-progress-highlight bg-components-progress-bar-progress"
          style={{ width: `${percent}%` }}
        />
      )}
      <div className="z-[1] flex h-full items-center gap-1 pl-[6px] pr-2">
        <SourceTypeIcon
          sourceType={sourceType}
          name={name}
          notionIcon={notionIcon}
        />
        <div className="flex w-0 grow items-center gap-1" title={name}>
          <div className="system-xs-medium truncate text-text-secondary">
            {name}
          </div>
          {enableBilling && <PriorityLabel className="ml-0" />}
        </div>
        {isEmbedding && (
          <div className="shrink-0 text-xs text-text-secondary">{`${percent}%`}</div>
        )}
        <StatusIcon status={detail.indexing_status} error={detail.error} />
      </div>
    </div>
  )
}

export default IndexingProgressItem
