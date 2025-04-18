// import { useState } from 'react'
import {
  RiArrowGoBackLine,
  RiCloseLine,
  RiMenuLine,
} from '@remixicon/react'
import { useStore } from '../store'
import { BlockEnum } from '../types'
import Empty from './empty'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import cn from '@/utils/classnames'

type Props = {
  handleOpenMenu: () => void
}

const Right = ({ handleOpenMenu }: Props) => {
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)

  return (
    <div className={cn('flex h-full flex-col')}>
      {/* header */}
      <div className='flex shrink-0 items-center justify-between gap-1 px-2 pt-2'>
        {bottomPanelWidth < 488 && (
          <ActionButton className='shrink-0' onClick={handleOpenMenu}>
            <RiMenuLine className='h-4 w-4' />
          </ActionButton>
        )}
        <div className='flex w-0 grow items-center gap-1'>
          <BlockIcon
            className='shrink-0'
            type={BlockEnum.LLM}
            size='xs'
          />
          <div className='system-sm-regular shrink-0 text-text-secondary'>LLM</div>
          <div className='system-sm-regular shrink-0 text-text-quaternary'>/</div>
          <div title='out_put' className='system-sm-semibold truncate text-text-secondary'>out_put</div>
          <div className='system-xs-medium ml-1 shrink-0 text-text-tertiary'>String</div>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <Badge>
            <span className='ml-[2.5px] mr-[4.5px] h-[3px] w-[3px] rounded bg-text-accent-secondary'></span>
            <span className='system-2xs-semibold-uupercase'>Edited</span>
          </Badge>
          <Tooltip popupContent={'Reset to last run value'}>
            <ActionButton onClick={() => setShowVariableInspectPanel(false)}>
              <RiArrowGoBackLine className='h-4 w-4' />
            </ActionButton>
          </Tooltip>
          <CopyFeedback content='' />
          <ActionButton onClick={() => setShowVariableInspectPanel(false)}>
            <RiCloseLine className='h-4 w-4' />
          </ActionButton>
        </div>
      </div>
      {/* content */}
      <div className='grow p-2'>
        <Empty />
      </div>
    </div>
  )
}

export default Right
