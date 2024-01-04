'use client'
import type { FC } from 'react'
import React from 'react'

export type IProviderNameProps = {
  provideName: string
}

const ProviderName: FC<IProviderNameProps> = ({
  provideName,
}) => {
  return (
    <span>
      {provideName}
    </span>
  )
}
export default React.memo(ProviderName)
