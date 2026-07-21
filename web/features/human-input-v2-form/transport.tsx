'use client'
import type { ReactNode } from 'react'
import type { HumanInputV2FormTransport } from './types'
import { HumanInputV2FormTransportContext } from './transport-context'

export const HumanInputV2FormTransportProvider = ({
  children,
  transport,
}: {
  children: ReactNode
  transport: HumanInputV2FormTransport
}) => (
  <HumanInputV2FormTransportContext value={transport}>{children}</HumanInputV2FormTransportContext>
)
