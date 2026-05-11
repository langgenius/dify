'use client'
import type { FC } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import { ApiConnection } from '@/app/components/base/icons/src/vender/solid/development'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import { InputVarType } from '@/app/components/workflow/types'

type Props = {
  onChange: (value: string) => void
}

type ItemProps = {
  text: string
  value: string
  Icon?: any
  type?: InputVarType
  onClick: (value: string) => void
}

const SelectItem: FC<ItemProps> = ({ text, type, value, Icon, onClick }) => {
  return (
    <DropdownMenuItem
      closeOnClick
      className="h-8 rounded-lg px-3 text-text-primary"
      onClick={() => onClick(value)}
    >
      {Icon ? <Icon className="h-4 w-4 text-text-secondary" /> : <InputVarTypeIcon type={type!} className="h-4 w-4 text-text-secondary" />}
      <div className="ml-2 truncate text-xs text-text-primary">{text}</div>
    </DropdownMenuItem>
  )
}

const SelectVarType: FC<Props> = ({
  onChange,
}) => {
  const { t } = useTranslation()
  const handleChange = (value: string) => {
    onChange(value)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        nativeButton={false}
        render={<div className="block" />}
      >
        <OperationBtn type="add" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={8}
        alignOffset={-2}
        popupClassName="min-w-[192px] rounded-lg border bg-components-panel-bg-blur p-0 backdrop-blur-xs"
      >
        <div className="p-1">
          <SelectItem type={InputVarType.textInput} value="string" text={t('variableConfig.string', { ns: 'appDebug' })} onClick={handleChange}></SelectItem>
          <SelectItem type={InputVarType.paragraph} value="paragraph" text={t('variableConfig.paragraph', { ns: 'appDebug' })} onClick={handleChange}></SelectItem>
          <SelectItem type={InputVarType.select} value="select" text={t('variableConfig.select', { ns: 'appDebug' })} onClick={handleChange}></SelectItem>
          <SelectItem type={InputVarType.number} value="number" text={t('variableConfig.number', { ns: 'appDebug' })} onClick={handleChange}></SelectItem>
          <SelectItem type={InputVarType.checkbox} value="checkbox" text={t('variableConfig.checkbox', { ns: 'appDebug' })} onClick={handleChange}></SelectItem>
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <SelectItem Icon={ApiConnection} value="api" text={t('variableConfig.apiBasedVar', { ns: 'appDebug' })} onClick={handleChange}></SelectItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(SelectVarType)
