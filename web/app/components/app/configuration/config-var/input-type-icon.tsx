'use client'
import React from 'react'
import type { FC } from 'react'
import { Paragraph, TypeSquare } from '@/app/components/base/icons/src/vender/solid/editor'
import { CheckDone01 } from '@/app/components/base/icons/src/vender/solid/general'
import { ApiConnection } from '@/app/components/base/icons/src/vender/solid/development'

export type IInputTypeIconProps = {
  type: 'string' | 'select'
  className: string
}

const IconMap = (type: IInputTypeIconProps['type'], className: string) => {
  const classNames = `w-3.5 h-3.5 ${className}`
  const icons = {
    string: (
      <TypeSquare className={classNames} />
    ),
    paragraph: (
      <Paragraph className={classNames} />
    ),
    select: (
      <CheckDone01 className={classNames} />
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
