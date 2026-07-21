'use client'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { VarType } from '@/app/components/workflow/nodes/tool/types'

type Props = Readonly<{
  disabled?: boolean
  value: VarType
  onChange: (value: VarType) => void
}>

const FormInputTypeSwitch = ({ disabled = false, value, onChange }: Props) => {
  const { t } = useTranslation()
  const variableLabel = t(($) => $['nodes.common.typeSwitch.variable'], { ns: 'workflow' })
  const inputLabel = t(($) => $['nodes.common.typeSwitch.input'], { ns: 'workflow' })

  return (
    <SegmentedControl<VarType>
      className="h-8 shrink-0"
      disabled={disabled}
      value={[value]}
      onValueChange={(nextValues) => {
        const nextValue = nextValues[0]
        if (nextValue && nextValue !== value) onChange(nextValue)
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SegmentedControlItem value={VarType.variable} aria-label={variableLabel}>
              <Variable02 className="size-4" />
            </SegmentedControlItem>
          }
        />
        <TooltipContent>{variableLabel}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <SegmentedControlItem value={VarType.constant} aria-label={inputLabel}>
              <span aria-hidden className="i-ri-edit-line size-4" />
            </SegmentedControlItem>
          }
        />
        <TooltipContent>{inputLabel}</TooltipContent>
      </Tooltip>
    </SegmentedControl>
  )
}
export default FormInputTypeSwitch
