'use client'
import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import { useState } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import { buildInstalledAppPath } from '@/app/components/explore/installed-app/routes'
import ItemOperation from '@/app/components/explore/item-operation'
import Link from '@/next/link'

type IAppNavItemProps = {
  ariaLabel: string
  app: InstalledAppResponse
  isSelected: boolean
  onTogglePin: (id: string, isPinned: boolean) => void
  onDelete: (id: string) => void
}

export default function AppNavItem({
  ariaLabel,
  app: installedApp,
  isSelected,
  onTogglePin,
  onDelete,
}: IAppNavItemProps) {
  const [isPrefetchEnabled, setIsPrefetchEnabled] = useState(false)
  const {
    id,
    is_pinned: isPinned,
    uninstallable,
    app: { name, icon_type, icon, icon_background, icon_url },
  } = installedApp
  const url = buildInstalledAppPath(id)

  return (
    <div
      key={id}
      className="group flex h-8 items-center justify-between gap-2 rounded-lg py-0.5 pr-0.5 pl-2 transition-colors not-has-[>a[aria-current=page]]:hover:bg-state-base-hover has-[>a:focus-visible]:inset-ring-2 has-[>a:focus-visible]:inset-ring-state-accent-solid has-[>a[aria-current=page]]:bg-state-base-active"
    >
      <Link
        href={url}
        prefetch={isPrefetchEnabled ? null : false}
        onMouseEnter={() => setIsPrefetchEnabled(true)}
        onFocus={() => setIsPrefetchEnabled(true)}
        aria-current={isSelected ? 'page' : undefined}
        aria-label={ariaLabel}
        title={name}
        className="flex min-w-0 flex-1 items-center gap-2 outline-hidden"
      >
        <AppIcon
          size="tiny"
          className="size-5 rounded-md text-sm"
          iconType={icon_type}
          icon={icon ?? undefined}
          background={icon_background}
          imageUrl={icon_url}
        />
        <div className="min-w-0 flex-1 truncate py-1 pr-1 system-sm-regular" title={name}>
          {name}
        </div>
      </Link>
      <div className="h-6 shrink-0">
        <ItemOperation
          isPinned={isPinned}
          togglePin={() => onTogglePin(id, !isPinned)}
          isShowDelete={!uninstallable && !isSelected}
          onDelete={() => onDelete(id)}
        />
      </div>
    </div>
  )
}
