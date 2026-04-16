'use client'

import type { EvaluationLogItem } from '@/models/log'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { getNodeVisual, getToneClasses } from '@/app/components/evaluation/components/metric-selector/utils'

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
      <div className="system-sm-regular flex items-center justify-center px-2 py-3 text-text-quaternary">
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
          {evaluation.map((item, index) => {
            const nodeVisual = item.nodeInfo ? getNodeVisual(item.nodeInfo) : null
            const nodeToneClasses = nodeVisual ? getToneClasses(nodeVisual.tone) : null

            return (
              <div
                key={`${item.name}-${index}`}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3',
                  index !== evaluation.length - 1 && 'border-b border-divider-subtle',
                )}
              >
                <div className="min-w-0">
                  <div className="system-sm-medium truncate text-text-secondary">{item.name}</div>
                  {item.nodeInfo && nodeVisual && nodeToneClasses && (
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      <div className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-[0.45px] border-divider-subtle shadow-xs shadow-shadow-shadow-3', nodeToneClasses.solid)}>
                        <span aria-hidden="true" className={cn(nodeVisual.icon, 'h-3.5 w-3.5')} />
                      </div>
                      <span className="system-xs-regular truncate text-text-tertiary">
                        {item.nodeInfo.title}
                      </span>
                    </div>
                  )}
                </div>
                <div className="system-sm-regular max-w-[120px] text-right wrap-break-word text-text-secondary">
                  {formatEvaluationValue(item.value)}
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default EvaluationCell
