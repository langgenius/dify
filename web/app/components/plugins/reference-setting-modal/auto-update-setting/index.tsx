'use client'
import type { FC } from 'react'
import React from 'react'
import type { AutoUpdateConfig } from './types'

type Props = {
  payload: AutoUpdateConfig
}

const AutoUpdateSetting: FC<Props> = ({
  payload,
}) => {
  console.log(payload)
  return (
    <div>
    </div>
  )
}
export default React.memo(AutoUpdateSetting)
