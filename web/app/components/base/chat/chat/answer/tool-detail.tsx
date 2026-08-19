import type { ToolInfoInThought } from '../type'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowDownSLine, RiArrowRightSLine, RiHammerFill, RiLoader2Line } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type ToolDetailProps = {
  payload: ToolInfoInThought
}
const ToolDetail = ({ payload }: ToolDetailProps) => {
  const { t } = useTranslation()
  const { name, label, input, isFinished, output } = payload
  const toolLabel = name.startsWith('dataset_') ? t(($) => $.knowledge, { ns: 'dataset' }) : label
  const [expand, setExpand] = useState(false)

  return (
    <div
      className={cn(
        'rounded-xl',
        !expand && 'border-l-[0.25px] border-components-panel-border bg-workflow-process-bg',
        expand && 'border-[0.5px] border-components-panel-border-subtle bg-background-section-burn',
      )}
    >
      <button
        type="button"
        aria-expanded={expand}
        className={cn(
          'flex w-full cursor-pointer appearance-none items-center rounded-xl px-2.5 py-2 text-start system-xs-medium text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
          expand && 'pb-1.5',
        )}
        onClick={() => setExpand(!expand)}
      >
        {isFinished && <RiHammerFill aria-hidden="true" className="mr-1 size-3.5" />}
        {!isFinished && <RiLoader2Line aria-hidden="true" className="mr-1 size-3.5 animate-spin" />}
        {t(($) => $[`thought.${isFinished ? 'used' : 'using'}`], { ns: 'tools' })}
        <span className="mx-1 text-text-secondary">{toolLabel}</span>
        {!expand && <RiArrowRightSLine aria-hidden="true" className="size-4" />}
        {expand && <RiArrowDownSLine aria-hidden="true" className="ml-auto size-4" />}
      </button>
      {expand && (
        <>
          <div className="mx-1 mb-0.5 rounded-[10px] bg-components-panel-on-panel-item-bg text-text-secondary">
            <div className="flex h-7 items-center justify-between px-2 pt-1 system-xs-semibold-uppercase">
              {t(($) => $['thought.requestTitle'], { ns: 'tools' })}
            </div>
            <div className="px-3 pt-1 pb-2 code-xs-regular wrap-break-word">{input}</div>
          </div>
          <div className="mx-1 mb-1 rounded-[10px] bg-components-panel-on-panel-item-bg text-text-secondary">
            <div className="flex h-7 items-center justify-between px-2 pt-1 system-xs-semibold-uppercase">
              {t(($) => $['thought.responseTitle'], { ns: 'tools' })}
            </div>
            <div className="px-3 pt-1 pb-2 code-xs-regular wrap-break-word">{output}</div>
          </div>
        </>
      )}
    </div>
  )
}

export default ToolDetail
