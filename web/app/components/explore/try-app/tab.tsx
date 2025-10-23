'use client'
import type { FC } from 'react'
import React from 'react'
import TabHeader from '../../base/tab-header'

export enum TypeEnum {
  TRY = 'try',
  DETAIL = 'detail',
}

type Props = {
  value: TypeEnum
  onChange: (value: TypeEnum) => void
}

const Tab: FC<Props> = ({
  value,
  onChange,
}) => {
  const tabs = [
    { id: TypeEnum.TRY, name: 'Try App' },
    { id: TypeEnum.DETAIL, name: 'App Details' },
  ]
  return (
    <div>
      <TabHeader
        items={tabs}
        value={value}
        onChange={onChange as (value: string) => void}
      />
    </div>
  )
}
export default React.memo(Tab)
