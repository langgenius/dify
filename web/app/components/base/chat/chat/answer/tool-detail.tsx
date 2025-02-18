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
        !expand && 'border-components-panel-border bg-workflow-process-bg border-l-[0.25px]',
        expand && 'border-components-panel-border-subtle bg-background-section-burn border-[0.5px]',
      )}
    >
      <div
        className={cn(
          'system-xs-medium text-text-tertiary flex cursor-pointer items-center px-2.5 py-2',
          expand && 'pb-1.5',
        )}
        onClick={() => setExpand(!expand)}
      >
        {isFinished && <RiHammerFill className='mr-1 h-3.5 w-3.5' />}
        {!isFinished && <RiLoader2Line className='mr-1 h-3.5 w-3.5 animate-spin' />}
        {t(`tools.thought.${isFinished ? 'used' : 'using'}`)}
        <div className='text-text-secondary mx-1'>{toolLabel}</div>
        {!expand && <RiArrowRightSLine className='h-4 w-4' />}
        {expand && <RiArrowDownSLine className='ml-auto h-4 w-4' />}
      </div>
      {
        expand && (
          <>
            <div className='bg-components-panel-on-panel-item-bg text-text-secondary mx-1 mb-0.5 rounded-[10px]'>
              <div className='system-xs-semibold-uppercase flex h-7 items-center justify-between px-2 pt-1'>
                {t('tools.thought.requestTitle')}
              </div>
              <div className='code-xs-regular break-words px-3 pb-2 pt-1'>
                {input}
              </div>
            </div>
            <div className='bg-components-panel-on-panel-item-bg text-text-secondary mx-1 mb-1 rounded-[10px]'>
              <div className='system-xs-semibold-uppercase flex h-7 items-center justify-between px-2 pt-1'>
                {t('tools.thought.responseTitle')}
              </div>
              <div className='code-xs-regular break-words px-3 pb-2 pt-1'>
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
