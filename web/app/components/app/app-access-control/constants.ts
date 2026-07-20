import type { SelectorParam } from 'i18next'
import type { ComponentType } from 'react'
import { RiBuildingLine, RiGlobalLine, RiLockLine, RiVerifiedBadgeLine } from '@remixicon/react'
import { AccessMode } from '@/models/access-control'

type AccessModeIcon = ComponentType<{ className?: string }>

export const ACCESS_MODE_ICON_MAP: Record<AccessMode, AccessModeIcon> = {
  [AccessMode.ORGANIZATION]: RiBuildingLine,
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: RiLockLine,
  [AccessMode.PUBLIC]: RiGlobalLine,
  [AccessMode.EXTERNAL_MEMBERS]: RiVerifiedBadgeLine,
}

export const ACCESS_MODE_LABEL_MAP: Record<AccessMode, SelectorParam<'app'>> = {
  [AccessMode.ORGANIZATION]: ($) => $['accessControlDialog.accessItems.organization'],
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: ($) => $['accessControlDialog.accessItems.specific'],
  [AccessMode.PUBLIC]: ($) => $['accessControlDialog.accessItems.anyone'],
  [AccessMode.EXTERNAL_MEMBERS]: ($) => $['accessControlDialog.accessItems.external'],
}
