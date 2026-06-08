'use client'
import type { PropsWithChildren } from 'react'
import type { AccessMode } from '@/models/access-control'
import { AccessControlOptionCard } from '@/app/components/base/access-control-option-card'
import useAccessControlStore from '@/context/access-control-store'

type AccessControlItemProps = PropsWithChildren<{
  type: AccessMode
}>

export function AccessControlItem({ type, children }: AccessControlItemProps) {
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const setCurrentMenu = useAccessControlStore(s => s.setCurrentMenu)
  const selected = currentMenu === type

  return (
    <AccessControlOptionCard
      selected={selected}
      onSelect={selected ? undefined : () => setCurrentMenu(type)}
    >
      {children}
    </AccessControlOptionCard>
  )
}
