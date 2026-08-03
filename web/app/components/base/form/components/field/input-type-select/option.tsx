import type { FileTypeSelectOption } from './types'
import * as React from 'react'
import Badge from '@/app/components/base/badge'

type OptionProps = {
  option: FileTypeSelectOption
}

const Option = ({ option }: OptionProps) => {
  return (
    <>
      <option.Icon className="size-4 shrink-0 text-text-tertiary" />
      <span className="grow px-1">{option.label}</span>
      <Badge text={option.type} uppercase={false} />
    </>
  )
}

export default React.memo(Option)
