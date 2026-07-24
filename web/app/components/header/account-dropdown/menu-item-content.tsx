import type { ReactNode } from 'react'
import { cn } from '@/utils/classnames'

const menuLabelClassName = 'min-w-0 grow truncate px-1 text-text-secondary system-md-regular'
const menuLeadingIconClassName = 'size-4 shrink-0 text-text-tertiary'

export const menuTrailingIconClassName = 'size-[14px] shrink-0 text-text-tertiary'

type MenuItemContentProps = {
  iconClassName: string
  label: ReactNode
  trailing?: ReactNode
}

export function MenuItemContent({
  iconClassName,
  label,
  trailing,
}: MenuItemContentProps) {
  return (
    <>
      <span aria-hidden className={cn(menuLeadingIconClassName, iconClassName)} />
      <div className={menuLabelClassName}>{label}</div>
      {trailing}
    </>
  )
}

export function ExternalLinkIndicator() {
  return <span aria-hidden className={cn('i-ri-arrow-right-up-line', menuTrailingIconClassName)} />
}
