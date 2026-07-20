'use client'

import { cn } from '@langgenius/dify-ui/cn'

export const MarketplaceInstallSourceIcon = () => (
  <span aria-hidden className="i-custom-vender-plugin-box-sparkle-fill size-4 shrink-0" />
)

export const GithubInstallSourceIcon = () => (
  <span aria-hidden className="i-custom-vender-solid-general-github size-4 shrink-0" />
)

export const LocalPackageInstallSourceIcon = () => (
  <span aria-hidden className="i-custom-vender-solid-files-file-zip size-4 shrink-0" />
)

export const DropHintInstallSourceIcon = ({ className }: { className?: string }) => (
  <span aria-hidden className={cn('i-ri-drag-drop-line size-4 shrink-0', className)} />
)
