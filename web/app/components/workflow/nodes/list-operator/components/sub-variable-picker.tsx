'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { SUB_VARIABLES } from '../../constants'

type Props = {
  value: string
  onChange: (value: string) => void
  className?: string
}

type SubVariableOption = {
  value: string
  name: string
}

const SubVariablePicker: FC<Props> = ({
  value,
  onChange,
  className,
}) => {
  const { t } = useTranslation()
  const subVarOptions = useMemo<SubVariableOption[]>(() => SUB_VARIABLES.map(item => ({
    value: item,
    name: item,
  })), [])
  const selectedOption = useMemo(() => {
    return subVarOptions.find(option => option.value === value) ?? null
  }, [subVarOptions, value])

  return (
    <div className={cn(className)}>
      <Select value={selectedOption?.value ?? null} onValueChange={nextValue => nextValue && onChange(nextValue)}>
        <SelectTrigger className="h-8 border-0 bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent [&>*:last-child]:hidden">
          <div className="group/sub-variable-picker flex h-8 items-center rounded-lg bg-components-input-bg-normal pl-1 hover:bg-state-base-hover-alt">
            {selectedOption
              ? (
                  <div className="flex cursor-pointer justify-start">
                    <div className="inline-flex h-6 max-w-full items-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1.5 text-text-accent shadow-xs">
                      <Variable02 className="h-3.5 w-3.5 shrink-0 text-text-accent" />
                      <div className="ml-0.5 truncate system-xs-medium">{selectedOption.name}</div>
                    </div>
                  </div>
                )
              : (
                  <div className="flex pl-1 system-sm-regular text-components-input-text-placeholder group-hover/sub-variable-picker:text-text-tertiary">
                    <Variable02 className="mr-1 h-4 w-4 shrink-0" />
                    <span>{t('placeholder.select', { ns: 'common' })}</span>
                  </div>
                )}
          </div>
        </SelectTrigger>
        <SelectContent popupClassName="w-[165px]" listClassName="max-h-none p-1">
          {subVarOptions.map(option => (
            <SelectItem key={option.value} value={option.value} className="h-8 py-0 pr-5 pl-1">
              <div className="flex h-6 items-center justify-between">
                <div className="flex h-full items-center">
                  <Variable02 className="mr-[5px] h-3.5 w-3.5 text-text-accent" />
                  <SelectItemText className="mr-0 px-0 system-sm-medium text-text-secondary">{option.name}</SelectItemText>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
export default React.memo(SubVariablePicker)
