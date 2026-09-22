'use client'
import type { FC, ReactNode } from 'react'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'

type Props = Readonly<{
  value: VarKindType
  onChange: (value: VarKindType) => void
  readonly?: boolean
}>

type TypeOptionProps = {
  children: ReactNode
  label: string
  selected: boolean
  value: VarKindType
}

const optionClassName =
  'cursor-pointer border-0 px-2.5 py-1.5 text-text-tertiary transition-none hover:text-text-tertiary data-checked:border-0 data-checked:text-text-secondary data-checked:shadow-black/5 data-checked:hover:bg-components-segmented-control-item-active-bg data-checked:hover:text-text-secondary data-disabled:text-text-tertiary data-disabled:data-checked:bg-components-segmented-control-item-active-bg data-disabled:data-checked:text-text-secondary data-disabled:data-checked:shadow-xs data-disabled:data-checked:shadow-black/5'

function TypeOption({ children, label, selected, value }: TypeOptionProps) {
  const option = (
    <SegmentedControlItem<VarKindType> value={value} aria-label={label} className={optionClassName}>
      {children}
    </SegmentedControlItem>
  )

  if (selected) return option

  return (
    <Tooltip>
      <TooltipTrigger render={option} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const FormInputTypeSwitch: FC<Props> = ({ value, onChange, readonly = false }) => {
  const { t } = useTranslation()
  const variableLabel = t(($) => $['nodes.common.typeSwitch.variable'], { ns: 'workflow' })
  const inputLabel = t(($) => $['nodes.common.typeSwitch.input'], { ns: 'workflow' })

  return (
    <SegmentedControl<VarKindType>
      value={value}
      onValueChange={(value) => onChange(value)}
      disabled={readonly}
      aria-label={`${variableLabel}, ${inputLabel}`}
      className="h-8 shrink-0"
    >
      <TypeOption
        value={VarKindType.variable}
        label={variableLabel}
        selected={value === VarKindType.variable}
      >
        <span aria-hidden className="i-custom-vender-solid-development-variable-02 size-4" />
      </TypeOption>
      <TypeOption
        value={VarKindType.constant}
        label={inputLabel}
        selected={value === VarKindType.constant}
      >
        <span aria-hidden className="i-ri-edit-line size-4" />
      </TypeOption>
    </SegmentedControl>
  )
}

export default FormInputTypeSwitch
