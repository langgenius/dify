import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiHammerFill,
  RiLoader2Line,
} from '@remixicon/react'
import type { ToolInfoInThought } from '../type'
import cn from '@/utils/classnames'

type ToolDetailProps = {
  payload: ToolInfoInThought
}
const ToolDetail = ({
  payload,
}: ToolDetailProps) => {
  const { t } = useTranslation()
  const { name, label, input, isFinished, output } = payload
  const toolLabel = name.startsWith('dataset_') ? t('dataset.knowledge') : label
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
          'flex items-center system-xs-medium text-text-tertiary px-2.5 py-2 cursor-pointer',
          expand && 'pb-1.5',
        )}
        onClick={() => setExpand(!expand)}
      >
        {isFinished && <RiHammerFill className='mr-1 w-3.5 h-3.5' />}
        {!isFinished && <RiLoader2Line className='mr-1 w-3.5 h-3.5 animate-spin' />}
        {t(`tools.thought.${isFinished ? 'used' : 'using'}`)}
        <div className='mx-1 text-text-secondary'>{toolLabel}</div>
        {!expand && <RiArrowRightSLine className='w-4 h-4' />}
        {expand && <RiArrowDownSLine className='ml-auto w-4 h-4' />}
      </div>
      {
        expand && (
          <>
            <div className='mb-0.5 mx-1 rounded-[10px] bg-components-panel-on-panel-item-bg text-text-secondary'>
              <div className='flex items-center justify-between px-2 pt-1 h-7 system-xs-semibold-uppercase'>
                {t('tools.thought.requestTitle')}
              </div>
              <div className='pt-1 px-3 pb-2 code-xs-regular break-words'>
                {input}
              </div>
            </div>
            <div className='mx-1 mb-1 rounded-[10px] bg-components-panel-on-panel-item-bg text-text-secondary'>
              <div className='flex items-center justify-between px-2 pt-1 h-7 system-xs-semibold-uppercase'>
                {t('tools.thought.responseTitle')}
              </div>
              <div className='pt-1 px-3 pb-2 code-xs-regular break-words'>
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
