'use client'
import type { FC } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { VarType } from '@/app/components/workflow/nodes/tool/types'

type Props = {
  value: VarType
  onChange: (value: VarType) => void
}

const FormInputTypeSwitch: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const variableLabel = t('nodes.common.typeSwitch.variable', { ns: 'workflow' })
  const inputLabel = t('nodes.common.typeSwitch.input', { ns: 'workflow' })

  return (
    <div className="inline-flex h-8 shrink-0 gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5">
      {value === VarType.variable
        ? (
            <button
              type="button"
              aria-label={variableLabel}
              className="cursor-pointer rounded-lg bg-components-segmented-control-item-active-bg px-2.5 py-1.5 text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg"
              onClick={() => onChange(VarType.variable)}
            >
              <Variable02 className="h-4 w-4" />
            </button>
          )
        : (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <button
                    type="button"
                    aria-label={variableLabel}
                    className="cursor-pointer rounded-lg px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover"
                    onClick={() => onChange(VarType.variable)}
                  >
                    <Variable02 className="h-4 w-4" />
                  </button>
                )}
              />
              <TooltipContent>{variableLabel}</TooltipContent>
            </Tooltip>
          )}
      {value === VarType.constant
        ? (
            <button
              type="button"
              aria-label={inputLabel}
              className="cursor-pointer rounded-lg bg-components-segmented-control-item-active-bg px-2.5 py-1.5 text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg"
              onClick={() => onChange(VarType.constant)}
            >
              <span aria-hidden className="i-ri-edit-line h-4 w-4" />
            </button>
          )
        : (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <button
                    type="button"
                    aria-label={inputLabel}
                    className="cursor-pointer rounded-lg px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover"
                    onClick={() => onChange(VarType.constant)}
                  >
                    <span aria-hidden className="i-ri-edit-line h-4 w-4" />
                  </button>
                )}
              />
              <TooltipContent>{inputLabel}</TooltipContent>
            </Tooltip>
          )}
    </div>
  )
}
export default FormInputTypeSwitch
