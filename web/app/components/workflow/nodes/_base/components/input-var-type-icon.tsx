'use client'
import type { FC } from 'react'
import React from 'react'
import { RiAlignLeft, RiCheckboxMultipleLine, RiFileCopy2Line, RiFileList2Line, RiHashtag, RiTextSnippet } from '@remixicon/react'
import { InputVarType } from '../../../types'

type Props = {
  className?: string
  type: InputVarType
}

const getIcon = (type: InputVarType) => {
  return ({
    [InputVarType.textInput]: RiTextSnippet,
    [InputVarType.paragraph]: RiAlignLeft,
    [InputVarType.select]: RiCheckboxMultipleLine,
    [InputVarType.number]: RiHashtag,
    [InputVarType.singleFile]: RiFileList2Line,
    [InputVarType.multiFiles]: RiFileCopy2Line,
  } as any)[type] || RiTextSnippet
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
