'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
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
    <div className={cn('inline-flex h-6 cursor-pointer select-none items-center space-x-1 rounded-md pl-1.5 pr-2 text-text-tertiary hover:bg-components-button-ghost-bg-hover', className)} onClick={() => onIsVariableChange?.(!isVariable)}>
      <Variable02 className="size-3.5" />
      <div className="system-xs-medium">{t(`nodes.humanInput.insertInputField.${isVariable ? 'useConstantInstead' : 'useVarInstead'}`, { ns: 'workflow' })}</div>
    </div>
  )
}
export default React.memo(TypeSwitch)
