'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'

type Props = {
  className?: string
  children: JSX.Element
}

const OutputVars: FC<Props> = ({
  className,
  children,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className={cn(className, 'leading-[18px] text-[13px] font-semibold text-gray-700 uppercase')}>
        {t('workflow.nodes.common.outputVars')}
      </div>
      <div className='mt-2 space-y-1'>
        {children}
      </div>
    </div>
  )
}
type VarItemProps = {
  name: string
  type: string
  description: string
}

export const VarItem: FC<VarItemProps> = ({
  name,
  type,
  description,
}) => {
  return (
    <div className='py-1'>
      <div className='flex leading-[18px]'>
        <div className='text-[13px] font-medium text-gray-900'>{name}</div>
        <div className='ml-2 text-xs font-normal text-gray-500 capitalize'>{type}</div>
      </div>
      <div className='mt-0.5 leading-[18px] text-xs font-normal text-gray-600'>{description}</div>
    </div>
  )
}
export default React.memo(OutputVars)
