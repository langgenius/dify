'use client'
import type { FC } from 'react'
import * as React from 'react'
import { ApiConnection } from '@/app/components/base/icons/src/vender/solid/development'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import { InputVarType } from '@/app/components/workflow/types'

export type IInputTypeIconProps = {
  type: 'string' | 'select'
  className: string
}

const IconMap = (type: IInputTypeIconProps['type'], className: string) => {
  const classNames = `w-3.5 h-3.5 ${className}`
  const icons = {
    string: (
      <InputVarTypeIcon type={InputVarType.textInput} className={classNames} />
    ),
    paragraph: (
      <InputVarTypeIcon type={InputVarType.paragraph} className={classNames} />
    ),
    select: (
      <InputVarTypeIcon type={InputVarType.select} className={classNames} />
    ),
    number: (
      <InputVarTypeIcon type={InputVarType.number} className={classNames} />
    ),
    api: (
      <ApiConnection className={classNames} />
    ),
  }

  return icons[type]
}

const InputTypeIcon: FC<IInputTypeIconProps> = ({
  type,
  className,
}) => {
  const Icon = IconMap(type, className)
  return Icon
}

export default React.memo(InputTypeIcon)
