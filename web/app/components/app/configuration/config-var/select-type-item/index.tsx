'use client'
import type { FC } from 'react'
import type { InputVarType } from '@/app/components/workflow/types'
import type { I18nKeysByPrefix } from '@/types/i18n'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import { cn } from '@/utils/classnames'

export type ISelectTypeItemProps = {
  type: InputVarType
  selected: boolean
  onClick: () => void
}

type VariableConfigTypeKey = I18nKeysByPrefix<'appDebug', 'variableConfig.'>

const i18nTypeMap: Partial<Record<InputVarType, VariableConfigTypeKey>> = {
  'file': 'single-file',
  'file-list': 'multi-files',
}

const SelectTypeItem: FC<ISelectTypeItemProps> = ({
  type,
  selected,
  onClick,
}) => {
  const { t } = useTranslation()
  const typeKey = i18nTypeMap[type] ?? type as VariableConfigTypeKey
  const typeName = t(`variableConfig.${typeKey}`, { ns: 'appDebug' })

  return (
    <div
      className={cn(
        'flex h-[58px] flex-col items-center justify-center space-y-1 rounded-lg border border-components-option-card-option-border bg-components-option-card-option-bg text-text-secondary',
        selected ? 'system-xs-medium border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs' : ' system-xs-regular cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
      )}
      onClick={onClick}
    >
      <div className="shrink-0">
        <InputVarTypeIcon type={type} className="h-5 w-5" />
      </div>
      <span>{typeName}</span>
    </div>
  )
}
export default React.memo(SelectTypeItem)
