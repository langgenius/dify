'use client'
import type { FC } from 'react'
import React from 'react'
import { VariableX } from '../../../icons/src/vender/workflow'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { Variable02 } from '../../../icons/src/vender/solid/development'
import { useTranslation } from 'react-i18next'

type Props = {
  nodeName: string
  varName: string
  isSelected: boolean
}

const ComponentUI: FC<Props> = ({
  nodeName,
  varName,
  // isSelected,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className='relative flex h-8 w-full select-none items-center rounded-[8px] border-[1.5px] border-components-input-border-active bg-background-default-hover pl-1.5 pr-0.5'
    >
      <div className='absolute left-2.5 top-[-12px]'>
        <div className='absolute bottom-1 h-[1.5px] w-full bg-background-default-subtle'></div>
        <div className='relative flex items-center space-x-0.5 px-1 text-text-accent-light-mode-only'>
          <VariableX className='size-3' />
          <div className='system-xs-medium'>{t('workflow.nodes.humanInput.editor.notes')}</div>
        </div>
      </div>

      <div className='flex h-[18px] items-center rounded-[5px] border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1 shadow-xs'>
        <div className='flex items-center space-x-0.5 text-text-secondary'>
          <VarBlockIcon type={BlockEnum.Start} />
          <div className='system-xs-medium'>{nodeName}</div>
        </div>
        <div className='system-xs-regular mx-px text-divider-deep'>/</div>
        <div className='flex items-center space-x-0.5 text-text-accent'>
          <Variable02 className='size-3.5' />
          <div className='system-xs-medium'>{varName}</div>
        </div>
      </div>
    </div>
  )
}

export default React.memo(ComponentUI)
