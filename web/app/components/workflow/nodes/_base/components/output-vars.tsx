'use client'
import type { FC, ReactNode } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'
import TreeIndentLine from './variable/object-child-tree-panel/tree-indent-line'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  title?: string
  children: ReactNode
  operations?: ReactNode
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
}

const OutputVars: FC<Props> = ({
  title,
  children,
  operations,
  collapsed,
  onCollapse,
}) => {
  const { t } = useTranslation()
  return (
    <FieldCollapse
      title={title || t('workflow.nodes.common.outputVars')}
      operations={operations}
      collapsed={collapsed}
      onCollapse={onCollapse}
    >
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
  isIndent?: boolean
}

export const VarItem: FC<VarItemProps> = ({
  name,
  type,
  description,
  subItems,
  isIndent,
}) => {
  return (
    <div className={cn('flex', isIndent && 'relative left-[-7px]')}>
      {isIndent && <TreeIndentLine depth={1} />}
      <div className='py-1'>
        <div className='flex'>
          <div className='flex items-center leading-[18px]'>
            <div className='code-sm-semibold text-text-secondary'>{name}</div>
            <div className='system-xs-regular ml-2 text-text-tertiary'>{type}</div>
          </div>
        </div>
        <div className='system-xs-regular mt-0.5 text-text-tertiary'>
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
    </div>
  )
}
export default React.memo(OutputVars)
