// import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowGoBackLine,
  RiCloseLine,
  RiMenuLine,
} from '@remixicon/react'
import { useStore } from '../store'
import { BlockEnum } from '../types'
import useCurrentVars from '../hooks/use-current-vars'
import Empty from './empty'
import ValueContent from './value-content'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import cn from '@/utils/classnames'

export const currentVar = {
  id: 'var-jfkldjjfkldaf-dfhekdfj',
  type: 'node',
  // type: 'conversation',
  // type: 'environment',
  name: 'out_put',
  var_type: 'string',
  // var_type: 'number',
  // var_type: 'object',
  // var_type: 'array[string]',
  // var_type: 'array[number]',
  // var_type: 'array[object]',
  // var_type: 'file',
  // var_type: 'array[file]',
  value: 'tuituitui',
  edited: true,
}

type Props = {
  handleOpenMenu: () => void
}

const Right = ({ handleOpenMenu }: Props) => {
  const { t } = useTranslation()
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)

  const current = currentVar

  const {
    resetToLastRunVar,
  } = useCurrentVars()

  const resetValue = () => {
    resetToLastRunVar('node_id', current.name)
  }

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
        {current && (
          <>
            {current.type === 'environment' && (
              <Env className='h-4 w-4 shrink-0 text-util-colors-violet-violet-600' />
            )}
            {current.type === 'conversation' && (
              <BubbleX className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />
            )}
            {current.type === 'node' && (
              <>
                <BlockIcon
                  className='shrink-0'
                  type={BlockEnum.LLM}
                  size='xs'
                />
                <div className='system-sm-regular shrink-0 text-text-secondary'>LLM</div>
                <div className='system-sm-regular shrink-0 text-text-quaternary'>/</div>
              </>
            )}
            <div title={current.name} className='system-sm-semibold truncate text-text-secondary'>{current.name}</div>
            <div className='system-xs-medium ml-1 shrink-0 text-text-tertiary'>{current.var_type}</div>
          </>
        )}
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          {current && (
            <>
              {current.edited && (
                <Badge>
                  <span className='ml-[2.5px] mr-[4.5px] h-[3px] w-[3px] rounded bg-text-accent-secondary'></span>
                  <span className='system-2xs-semibold-uupercase'>{t('workflow.debug.variableInspect.edited')}</span>
                </Badge>
              )}
              {current.edited && (
                <Tooltip popupContent={t('workflow.debug.variableInspect.reset')}>
                  <ActionButton onClick={resetValue}>
                    <RiArrowGoBackLine className='h-4 w-4' />
                  </ActionButton>
                </Tooltip>
              )}
              {(current.type !== 'environment' || current.var_type !== 'secret') && (
                <CopyFeedback content={current.value ? JSON.stringify(current.value) : ''} />
              )}
            </>
          )}
          <ActionButton onClick={() => setShowVariableInspectPanel(false)}>
            <RiCloseLine className='h-4 w-4' />
          </ActionButton>
        </div>
      </div>
      {/* content */}
      <div className='grow p-2'>
        {!current && <Empty />}
        {current && <ValueContent />}
      </div>
    </div>
  )
}

export default Right
