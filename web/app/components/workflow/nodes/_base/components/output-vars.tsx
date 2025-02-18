'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'

type Props = {
  className?: string
  title?: string
  children: ReactNode
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
      <div className='flex items-center leading-[18px]'>
        <div className='code-sm-semibold text-text-secondary'>{name}</div>
        <div className='system-xs-regular text-text-tertiary ml-2'>{type}</div>
      </div>
      <div className='system-xs-regular text-text-tertiary mt-0.5'>
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
