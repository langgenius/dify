'use client'
import type { FC } from 'react'
import React from 'react'
import { InputVarType } from '../../../types'
import { AlignLeft, LetterSpacing01 } from '@/app/components/base/icons/src/vender/line/editor'
import { CheckDone01, Hash02 } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  className?: string
  type: InputVarType
}

const getIcon = (type: InputVarType) => {
  return ({
    [InputVarType.textInput]: LetterSpacing01,
    [InputVarType.paragraph]: AlignLeft,
    [InputVarType.select]: CheckDone01,
    [InputVarType.number]: Hash02,
  } as any)[type] || LetterSpacing01
}

const InputVarTypeIcon: FC<Props> = ({
  className,
  type,
}) => {
  const Icon = getIcon(type)
  return (
    <Icon className={className} />
  )
}
export default React.memo(InputVarTypeIcon)
