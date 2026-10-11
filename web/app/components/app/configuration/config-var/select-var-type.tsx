'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { OperationButton } from '@/app/components/app/configuration/base/operation-button'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import { InputVarType } from '@/app/components/workflow/types'

type Props = Readonly<{
  onChange: (value: string) => void
}>

type ItemProps = {
  text: string
  value: string
  iconClassName?: string
  type?: InputVarType
  onClick: (value: string) => void
}

const SelectItem: FC<ItemProps> = ({ text, type, value, iconClassName, onClick }) => {
  return (
    <DropdownMenuItem
      closeOnClick
      className="h-8 rounded-lg px-3 text-text-primary"
      onClick={() => onClick(value)}
    >
      {iconClassName ? (
        <span aria-hidden className={cn(iconClassName, 'size-4 text-text-secondary')} />
      ) : (
        <InputVarTypeIcon type={type!} className="size-4 text-text-secondary" />
      )}
      <div className="ml-2 truncate text-xs text-text-primary">{text}</div>
    </DropdownMenuItem>
  )
}

const SelectVarType: FC<Props> = ({ onChange }) => {
  const { t } = useTranslation(['appDebug'])
  const handleChange = (value: string) => {
    onChange(value)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<OperationButton operation="add" />} />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={8}
        alignOffset={-2}
        className="min-w-48 rounded-lg border bg-components-panel-bg-blur p-0 backdrop-blur-xs"
      >
        <div className="p-1">
          <SelectItem
            type={InputVarType.textInput}
            value="string"
            text={t(($) => $['variableConfig.string'], { ns: 'appDebug' })}
            onClick={handleChange}
          ></SelectItem>
          <SelectItem
            type={InputVarType.paragraph}
            value="paragraph"
            text={t(($) => $['variableConfig.paragraph'], { ns: 'appDebug' })}
            onClick={handleChange}
          ></SelectItem>
          <SelectItem
            type={InputVarType.select}
            value="select"
            text={t(($) => $['variableConfig.select'], { ns: 'appDebug' })}
            onClick={handleChange}
          ></SelectItem>
          <SelectItem
            type={InputVarType.number}
            value="number"
            text={t(($) => $['variableConfig.number'], { ns: 'appDebug' })}
            onClick={handleChange}
          ></SelectItem>
          <SelectItem
            type={InputVarType.checkbox}
            value="checkbox"
            text={t(($) => $['variableConfig.checkbox'], { ns: 'appDebug' })}
            onClick={handleChange}
          ></SelectItem>
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <SelectItem
            iconClassName={'i-custom-vender-solid-development-api-connection'}
            value="api"
            text={t(($) => $['variableConfig.apiBasedVar'], { ns: 'appDebug' })}
            onClick={handleChange}
          ></SelectItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
export default React.memo(SelectVarType)
