'use client'

/**
 * Re-exports the legacy portal / floating positioning API without using the
 * restricted `@/app/components/base/portal-to-follow-elem` import path at call sites.
 * Prefer migrating to `@/app/components/base/ui/*` overlays when touching UI.
 */
export {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
  usePortalToFollowElem,
  usePortalToFollowElemContext,
} from '../portal-to-follow-elem'

export type { PortalToFollowElemOptions } from '../portal-to-follow-elem'
