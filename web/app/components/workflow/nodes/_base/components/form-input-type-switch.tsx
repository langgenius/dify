'use client'
import type { FC } from 'react'
import {
  RiEditLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import Tooltip from '@/app/components/base/tooltip'
import { VarType } from '@/app/components/workflow/nodes/tool/types'
import { cn } from '@/utils/classnames'

type Props = {
  value: VarType
  onChange: (value: VarType) => void
}

const FormInputTypeSwitch: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  return (
    <div className="inline-flex h-8 shrink-0 gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5">
      <Tooltip
        popupContent={value === VarType.variable ? '' : t('nodes.common.typeSwitch.variable', { ns: 'workflow' })}
      >
        <div
          className={cn('cursor-pointer rounded-lg px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover', value === VarType.variable && 'bg-components-segmented-control-item-active-bg text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg')}
          onClick={() => onChange(VarType.variable)}
        >
          <Variable02 className="h-4 w-4" />
        </div>
      </Tooltip>
      <Tooltip
        popupContent={value === VarType.constant ? '' : t('nodes.common.typeSwitch.input', { ns: 'workflow' })}
      >
        <div
          className={cn('cursor-pointer rounded-lg px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover', value === VarType.constant && 'bg-components-segmented-control-item-active-bg text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg')}
          onClick={() => onChange(VarType.constant)}
        >
          <RiEditLine className="h-4 w-4" />
        </div>
      </Tooltip>
    </div>
  )
}
export default FormInputTypeSwitch
