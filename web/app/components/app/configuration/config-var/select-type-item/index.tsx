'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import s from './style.module.css'
import cn from '@/utils/classnames'
import type { InputVarType } from '@/app/components/workflow/types'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
export type ISelectTypeItemProps = {
  type: InputVarType
  selected: boolean
  onClick: () => void
}

const SelectTypeItem: FC<ISelectTypeItemProps> = ({
  type,
  selected,
  onClick,
}) => {
  const { t } = useTranslation()
  const typeName = t(`appDebug.variableConfig.${type}`)

  return (
    <div
      className={cn(s.item, selected && s.selected, 'space-y-1')}
      onClick={onClick}
    >
      <div className='shrink-0'>
        <InputVarTypeIcon type={type} className='w-5 h-5' />
      </div>
      <span className={cn(s.text)}>{typeName}</span>
    </div>
  )
}
export default React.memo(SelectTypeItem)
