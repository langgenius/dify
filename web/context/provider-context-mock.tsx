'use client'
import type { FC } from 'react'
import React from 'react'
import { useProviderContext } from '@/context/provider-context'

const ProviderContextMock: FC = () => {
  const { plan } = useProviderContext()

  return (
    <div data-testid="plan-type">{plan.type}</div>
  )
}
export default React.memo(ProviderContextMock)
