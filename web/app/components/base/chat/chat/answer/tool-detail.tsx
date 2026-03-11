import type { ToolInfoInThought } from '../type'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiHammerFill,
  RiLoader2Line,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type ToolDetailProps = {
  payload: ToolInfoInThought
}
const ToolDetail = ({
  payload,
}: ToolDetailProps) => {
  const { t } = useTranslation()
  const { name, label, input, isFinished, output } = payload
  const toolLabel = name.startsWith('dataset_') ? t('knowledge', { ns: 'dataset' }) : label
  const [expand, setExpand] = useState(false)

  return (
    <div
      className={cn(
        'rounded-xl',
        !expand && 'border-l-[0.25px] border-components-panel-border bg-workflow-process-bg',
        expand && 'border-[0.5px] border-components-panel-border-subtle bg-background-section-burn',
      )}
    >
      <div
        className={cn(
          'system-xs-medium flex cursor-pointer items-center px-2.5 py-2 text-text-tertiary',
          expand && 'pb-1.5',
        )}
        onClick={() => setExpand(!expand)}
      >
        {isFinished && <RiHammerFill className="mr-1 h-3.5 w-3.5" />}
        {!isFinished && <RiLoader2Line className="mr-1 h-3.5 w-3.5 animate-spin" />}
        {t(`thought.${isFinished ? 'used' : 'using'}`, { ns: 'tools' })}
        <div className="mx-1 text-text-secondary">{toolLabel}</div>
        {!expand && <RiArrowRightSLine className="h-4 w-4" />}
        {expand && <RiArrowDownSLine className="ml-auto h-4 w-4" />}
      </div>
      {
        expand && (
          <>
            <div className="mx-1 mb-0.5 rounded-[10px] bg-components-panel-on-panel-item-bg text-text-secondary">
              <div className="system-xs-semibold-uppercase flex h-7 items-center justify-between px-2 pt-1">
                {t('thought.requestTitle', { ns: 'tools' })}
              </div>
              <div className="code-xs-regular break-words px-3 pb-2 pt-1">
                {input}
              </div>
            </div>
            <div className="mx-1 mb-1 rounded-[10px] bg-components-panel-on-panel-item-bg text-text-secondary">
              <div className="system-xs-semibold-uppercase flex h-7 items-center justify-between px-2 pt-1">
                {t('thought.responseTitle', { ns: 'tools' })}
              </div>
              <div className="code-xs-regular break-words px-3 pb-2 pt-1">
                {output}
              </div>
            </div>
          </>
        )
      }
    </div>
  )
}

export default ToolDetail
