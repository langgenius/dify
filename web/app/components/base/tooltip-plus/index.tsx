'use client'

/**
 * Re-exports the legacy default Tooltip API (popupContent, etc.) without using
 * the restricted `@/app/components/base/tooltip` import path at call sites.
 * Prefer migrating to `@/app/components/base/ui/tooltip` when touching UI.
 */
export { default } from '../tooltip'
