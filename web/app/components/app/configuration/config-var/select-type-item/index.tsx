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
        'flex flex-col justify-center items-center h-[58px] rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg space-y-1',
        selected ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs system-xs-medium' : ' hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs cursor-pointer system-xs-regular')}
      onClick={onClick}
    >
      <div className='shrink-0'>
        <InputVarTypeIcon type={type} className='w-5 h-5' />
      </div>
      <span>{typeName}</span>
    </div>
  )
}
export default React.memo(SelectTypeItem)
