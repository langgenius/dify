'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useProviderContext } from '@/context/provider-context'

const ProviderContextMock: FC = () => {
  const { plan } = useProviderContext()

  return (
    <div>
      <div data-testid="plan-type">{plan.type}</div>
      <div data-testid="plan-usage-build-apps">{plan.usage.buildApps}</div>
      <div data-testid="plan-total-build-apps">{plan.total.buildApps}</div>
      <div data-testid="plan-reset-api-rate-limit">{plan.reset.apiRateLimit}</div>
    </div>
  )
}
export default React.memo(ProviderContextMock)
