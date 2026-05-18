'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Variable02 } from '../../../icons/src/vender/solid/development'

type Props = {
  className?: string
  isVariable?: boolean
  onIsVariableChange?: (isVariable: boolean) => void
}

const TypeSwitch: FC<Props> = ({
  className,
  isVariable,
  onIsVariableChange,
}) => {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={cn('inline-flex h-6 cursor-pointer items-center space-x-1 rounded-md border-none bg-transparent py-0 pr-2 pl-1.5 text-left text-text-tertiary select-none hover:bg-components-button-ghost-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden', className)}
      onClick={() => onIsVariableChange?.(!isVariable)}
    >
      <Variable02 className="size-3.5" aria-hidden="true" />
      <div className="system-xs-medium">{t(`nodes.humanInput.insertInputField.${isVariable ? 'useConstantInstead' : 'useVarInstead'}`, { ns: 'workflow' })}</div>
    </button>
  )
}
export default React.memo(TypeSwitch)
