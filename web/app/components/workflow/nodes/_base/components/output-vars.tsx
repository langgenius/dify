'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'

type Props = {
  className?: string
  title?: string
  children: JSX.Element
}

const OutputVars: FC<Props> = ({
  title,
  children,
}) => {
  const { t } = useTranslation()
  return (
    <FieldCollapse title={title || t('workflow.nodes.common.outputVars')}>
      {children}
    </FieldCollapse>
  )
}
type VarItemProps = {
  name: string
  type: string
  description: string
  subItems?: {
    name: string
    type: string
    description: string
  }[]
}

export const VarItem: FC<VarItemProps> = ({
  name,
  type,
  description,
  subItems,
}) => {
  return (
    <div className='py-1'>
      <div className='flex leading-[18px] items-center'>
        <div className='code-sm-semibold text-text-secondary'>{name}</div>
        <div className='ml-2 system-xs-regular text-text-tertiary'>{type}</div>
      </div>
      <div className='mt-0.5 system-xs-regular text-text-tertiary'>
        {description}
        {subItems && (
          <div className='ml-2 border-l border-gray-200 pl-2'>
            {subItems.map((item, index) => (
              <VarItem
                key={index}
                name={item.name}
                type={item.type}
                description={item.description}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
export default React.memo(OutputVars)
