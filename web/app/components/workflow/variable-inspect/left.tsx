// import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  RiErrorWarningFill,
  RiLoader2Line,
} from '@remixicon/react'
// import { useStore } from '../store'
import { BlockEnum } from '../types'
import Button from '@/app/components/base/button'
//   import ActionButton from '@/app/components/base/action-button'
//   import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import useCurrentVars from '../hooks/use-current-vars'
import cn from '@/utils/classnames'

type Props = {
  handleMenuClick: (state: any) => void
}

const Left = ({ handleMenuClick }: Props) => {
  const { t } = useTranslation()

  // const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  // const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const {
    clearCurrentVars,
  } = useCurrentVars()

  // TODO node selection
  const selectedNode = 3 < 4

  return (
    <div className={cn('flex h-full flex-col')}>
      {/* header */}
      <div className='flex shrink-0 items-center justify-between gap-1 pl-4 pr-1 pt-2'>
        <div className='system-sm-semibold-uppercase truncate text-text-primary'>{t('workflow.debug.variableInspect.title')}</div>
        <Button variant='ghost' size='small' className='shrink-0' onClick={clearCurrentVars}>{t('workflow.debug.variableInspect.clearAll')}</Button>
      </div>
      {/* content */}
      <div className='grow overflow-y-auto py-1'>
        {/* group ENV */}
        <div className='p-0.5'>
          {/* node item */}
          <div className='flex h-6 items-center gap-0.5'>
            <RiArrowRightSLine className='h-3 w-3 rotate-90 text-text-tertiary' />
            <div className='flex grow cursor-pointer items-center gap-1'>
              <div className='system-xs-medium-uppercase truncate text-text-tertiary'>{t('workflow.env.envPanelTitle')}</div>
            </div>
          </div>
          {/* var item list */}
          <div className='px-0.5'>
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover')} onClick={handleMenuClick}>
              <Env className='h-4 w-4 shrink-0 text-util-colors-violet-violet-600' />
              <div className='system-sm-medium grow truncate text-text-secondary'>SECRET_KEY</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>string</div>
            </div>
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover', selectedNode && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt')}>
              {selectedNode && <span className='absolute left-1.5 top-[10.5px] h-[3px] w-[3px] rounded-full bg-text-accent-secondary'></span>}
              <Env className='h-4 w-4 shrink-0 text-util-colors-violet-violet-600' />
              <div className='system-sm-medium grow truncate text-text-secondary'>PORT</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>number</div>
            </div>
          </div>
        </div>
        {/* group CHAT VAR */}
        <div className='p-0.5'>
          {/* node item */}
          <div className='flex h-6 items-center gap-0.5'>
            <RiArrowRightSLine className='h-3 w-3 rotate-90 text-text-tertiary' />
            <div className='flex grow cursor-pointer items-center gap-1'>
              <div className='system-xs-medium-uppercase truncate text-text-tertiary'>{t('workflow.chatVariable.panelTitle')}</div>
            </div>
          </div>
          {/* var item list */}
          <div className='px-0.5'>
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover')}>
              <BubbleX className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />
              <div className='system-sm-medium grow truncate text-text-secondary'>chat_history</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>array</div>
            </div>
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover')}>
              {selectedNode && <span className='absolute left-1.5 top-[10.5px] h-[3px] w-[3px] rounded-full bg-text-accent-secondary'></span>}
              <BubbleX className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />
              <div className='system-sm-medium grow truncate text-text-secondary'>custom_chat_history</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>array</div>
            </div>
          </div>
        </div>
        {/* divider */}
        <div className='px-4 py-1'>
          <div className='h-px bg-divider-subtle'></div>
        </div>
        {/* group nodes */}
        <div className='p-0.5'>
          {/* node item */}
          <div className='flex h-6 items-center gap-0.5'>
            <RiArrowRightSLine className='h-3 w-3 rotate-90 text-text-tertiary' />
            <div className='flex grow cursor-pointer items-center gap-1'>
              <BlockIcon
                className='shrink-0'
                type={BlockEnum.LLM}
                size='xs'
              />
              <div className='system-xs-medium-uppercase truncate text-text-tertiary'>LLM</div>
            </div>
          </div>
          {/* var item list */}
          <div className='px-0.5'>
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover')}>
              <Variable02 className='h-4 w-4 text-text-accent' />
              <div className='system-sm-medium grow truncate text-text-secondary'>chat_history</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>array</div>
            </div>
            <div className={cn('relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover')}>
              {selectedNode && <span className='absolute left-1.5 top-[10.5px] h-[3px] w-[3px] rounded-full bg-text-accent-secondary'></span>}
              <Variable02 className='h-4 w-4 text-text-warning' />
              <div className='system-sm-medium grow truncate text-text-secondary'>custom_chat_history</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>array</div>
            </div>
          </div>
        </div>
        {/* group nodes */}
        <div className='p-0.5'>
          {/* node item */}
          <div className='flex h-6 items-center gap-0.5'>
            <RiLoader2Line className='h-3 w-3 text-text-accent' />
            <div className='flex grow cursor-pointer items-center gap-1'>
              <BlockIcon
                className='shrink-0'
                type={BlockEnum.QuestionClassifier}
                size='xs'
              />
              <div className='system-xs-medium-uppercase truncate text-text-tertiary'>Question Classifier</div>
            </div>
          </div>
        </div>
        {/* group nodes */}
        <div className='p-0.5'>
          {/* node item */}
          <div className='flex h-6 items-center gap-0.5'>
            <RiErrorWarningFill className='h-3 w-3 text-text-destructive' />
            <div className='flex grow cursor-pointer items-center gap-1'>
              <BlockIcon
                className='shrink-0'
                type={BlockEnum.HttpRequest}
                size='xs'
              />
              <div className='system-xs-medium-uppercase truncate text-text-tertiary'>HTTP Request</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Left
