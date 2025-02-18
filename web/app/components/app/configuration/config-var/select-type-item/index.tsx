'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import type { InputVarType } from '@/app/components/workflow/types'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
export type ISelectTypeItemProps = {
  type: InputVarType
  selected: boolean
  onClick: () => void
}

const i18nFileTypeMap: Record<string, string> = {
  'file': 'single-file',
  'file-list': 'multi-files',
}

const SelectTypeItem: FC<ISelectTypeItemProps> = ({
  type,
  selected,
  onClick,
}) => {
  const { t } = useTranslation()
  const typeName = t(`appDebug.variableConfig.${i18nFileTypeMap[type] || type}`)

  return (
    <div
      className={cn(
        'border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary flex h-[58px] flex-col items-center justify-center space-y-1 rounded-lg border',
        selected ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs system-xs-medium border-[1.5px]' : ' hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs system-xs-regular cursor-pointer')}
      onClick={onClick}
    >
      <div className='shrink-0'>
        <InputVarTypeIcon type={type} className='h-5 w-5' />
      </div>
      <span>{typeName}</span>
    </div>
  )
}
export default React.memo(SelectTypeItem)
