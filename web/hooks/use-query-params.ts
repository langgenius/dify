'use client'

/**
 * Centralized URL query parameter management hooks using nuqs
 *
 * This file provides type-safe, performant query parameter management
 * that doesn't trigger full page refreshes (shallow routing).
 *
 * Best practices from nuqs documentation:
 * - Use useQueryState for single parameters
 * - Use useQueryStates for reading and updating related parameters together
 * - Share parser definitions with serializers and loaders when needed
 * - Provide defaults only when missing or invalid values have a meaningful fallback
 * - Shallow routing avoids server navigation; React state still updates immediately
 */

import { createParser, useQueryStates } from 'nuqs'

/**
 * Plugin Installation Query Parameters
 */
const PACKAGE_IDS_PARAM = 'package-ids'
const BUNDLE_INFO_PARAM = 'bundle-info'
type BundleInfoQuery = {
  org: string
  name: string
  version: string
}

const parseAsPackageId = createParser<string>({
  parse: (value) => {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        const first = parsed[0]
        return typeof first === 'string' ? first : null
      }
      return value
    } catch {
      return value
    }
  },
  serialize: (value) => JSON.stringify([value]),
})

const parseAsBundleInfo = createParser<BundleInfoQuery>({
  parse: (value) => {
    try {
      const parsed = JSON.parse(value) as Partial<BundleInfoQuery>
      if (
        parsed &&
        typeof parsed.org === 'string' &&
        typeof parsed.name === 'string' &&
        typeof parsed.version === 'string'
      ) {
        return { org: parsed.org, name: parsed.name, version: parsed.version }
      }
    } catch {
      return null
    }
    return null
  },
  serialize: (value) => JSON.stringify(value),
})

/**
 * Hook to manage plugin installation state via URL
 * @returns [installState, setInstallState] - installState includes parsed packageId and bundleInfo
 *
 * @example
 * const [installState, setInstallState] = usePluginInstallation()
 * setInstallState({ packageId: 'org/plugin' }) // Sets ?package-ids=["org/plugin"]
 * setInstallState({ bundleInfo: { org: 'org', name: 'bundle', version: '1.0.0' } }) // Sets ?bundle-info=...
 * setInstallState(null) // Clears installation params
 */
export function usePluginInstallation() {
  return useQueryStates(
    {
      packageId: parseAsPackageId,
      bundleInfo: parseAsBundleInfo,
    },
    {
      urlKeys: {
        packageId: PACKAGE_IDS_PARAM,
        bundleInfo: BUNDLE_INFO_PARAM,
      },
    },
  )
}
