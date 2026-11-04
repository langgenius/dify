'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import { InputVarType } from '@/app/components/workflow/types'

export type IInputTypeIconProps = {
  type: 'string' | 'select'
  className: string
}

const IconMap = (type: IInputTypeIconProps['type'], className: string) => {
  const classNames = `size-3.5 ${className}`
  const icons = {
    string: <InputVarTypeIcon type={InputVarType.textInput} className={classNames} />,
    paragraph: <InputVarTypeIcon type={InputVarType.paragraph} className={classNames} />,
    select: <InputVarTypeIcon type={InputVarType.select} className={classNames} />,
    number: <InputVarTypeIcon type={InputVarType.number} className={classNames} />,
    api: (
      <span
        aria-hidden
        className={cn('i-custom-vender-solid-development-api-connection h-6 w-6', classNames)}
      />
    ),
  }

  return icons[type]
}

const InputTypeIcon: FC<IInputTypeIconProps> = ({ type, className }) => {
  const Icon = IconMap(type, className)
  return Icon
}

export default React.memo(InputTypeIcon)
