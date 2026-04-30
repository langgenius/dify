'use client'

import type { EvaluationLogItem } from '@/models/log'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getEvaluationNodeBlockType } from '@/app/components/evaluation/components/metric-selector/utils'
import BlockIcon from '@/app/components/workflow/block-icon'

type EvaluationCellProps = {
  evaluation: EvaluationLogItem[]
}

const formatEvaluationValue = (value: EvaluationLogItem['value']) => {
  if (typeof value === 'boolean')
    return value ? 'True' : 'False'

  return String(value)
}

const EvaluationCell = ({
  evaluation,
}: EvaluationCellProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!evaluation.length) {
    return (
      <div className="flex items-center justify-center px-2 py-3 system-sm-regular text-text-quaternary">
        -
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <button
            type="button"
            aria-label={t('table.header.evaluation', { ns: 'appLog' })}
            data-testid="workflow-log-evaluation-trigger"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors',
              'hover:bg-state-base-hover hover:text-text-secondary',
              open && 'bg-state-base-hover text-text-secondary',
            )}
          >
            <span aria-hidden="true" className="i-ri-eye-line h-4 w-4" />
          </button>
        )}
      />
      <PopoverContent
        placement="left-start"
        sideOffset={12}
        popupClassName="w-[320px] overflow-hidden rounded-xl border-[0.5px] border-components-panel-border p-0 shadow-[0px_12px_16px_-4px_rgba(9,9,11,0.08),0px_4px_6px_-2px_rgba(9,9,11,0.03)]"
      >
        <div data-testid="workflow-log-evaluation-popover" className="max-h-[320px] overflow-y-auto bg-components-panel-bg">
          {evaluation.map((item, index) => (
            <div
              key={item.nodeInfo ? `${item.name}-${item.nodeInfo.node_id}` : item.name}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3',
                index !== evaluation.length - 1 && 'border-b border-divider-subtle',
              )}
            >
              <div className="min-w-0">
                <div className="truncate system-sm-medium text-text-secondary">{item.name}</div>
                {item.nodeInfo && (
                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <BlockIcon
                      type={getEvaluationNodeBlockType(item.nodeInfo)}
                      size="xs"
                      className="h-[18px] w-[18px] shrink-0"
                    />
                    <span className="truncate system-xs-regular text-text-tertiary">
                      {item.nodeInfo.title}
                    </span>
                  </div>
                )}
              </div>
              <div className="max-w-[120px] text-right system-sm-regular wrap-break-word text-text-secondary">
                {formatEvaluationValue(item.value)}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default EvaluationCell
