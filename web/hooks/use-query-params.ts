'use client'

/**
 * Centralized URL query parameter management hooks using nuqs
 *
 * This file provides type-safe, performant query parameter management
 * that doesn't trigger full page refreshes (shallow routing).
 *
 * Best practices from nuqs documentation:
 * - Use useQueryState for single parameters
 * - Use useQueryStates for multiple related parameters (atomic updates)
 * - Always provide parsers with defaults for type safety
 * - Use shallow routing to avoid unnecessary re-renders
 */

import {
  createParser,
  parseAsString,
  useQueryState,
  useQueryStates,
} from 'nuqs'
import { useCallback } from 'react'
import { ACCOUNT_SETTING_MODAL_ACTION } from '@/app/components/header/account-setting/constants'
import { isServer } from '@/utils/client'

/**
 * Modal State Query Parameters
 * Manages modal visibility and configuration via URL
 */
export const PRICING_MODAL_QUERY_PARAM = 'pricing'
export const PRICING_MODAL_QUERY_VALUE = 'open'
const parseAsPricingModal = createParser<boolean>({
  parse: value => (value === PRICING_MODAL_QUERY_VALUE ? true : null),
  serialize: value => (value ? PRICING_MODAL_QUERY_VALUE : ''),
})
  .withDefault(false)
  .withOptions({ history: 'push' })

/**
 * Hook to manage pricing modal state via URL
 * @returns [isOpen, setIsOpen] - Tuple like useState
 *
 * @example
 * const [isOpen, setIsOpen] = usePricingModal()
 * setIsOpen(true) // Sets ?pricing=open
 * setIsOpen(false) // Removes ?pricing
 */
export function usePricingModal() {
  return useQueryState(
    PRICING_MODAL_QUERY_PARAM,
    parseAsPricingModal,
  )
}

/**
 * Hook to manage account setting modal state via URL
 * @returns [state, setState] - Object with isOpen + payload (tab) and setter
 *
 * @example
 * const [accountModalState, setAccountModalState] = useAccountSettingModal()
 * setAccountModalState({ payload: 'billing' }) // Sets ?action=showSettings&tab=billing
 * setAccountModalState(null) // Removes both params
 */
export function useAccountSettingModal<T extends string = string>() {
  const [accountState, setAccountState] = useQueryStates(
    {
      action: parseAsString,
      tab: parseAsString,
    },
    {
      history: 'replace',
    },
  )

  const setState = useCallback(
    (state: { payload: T } | null) => {
      if (!state) {
        setAccountState({ action: null, tab: null }, { history: 'replace' })
        return
      }
      const shouldPush = accountState.action !== ACCOUNT_SETTING_MODAL_ACTION
      setAccountState(
        { action: ACCOUNT_SETTING_MODAL_ACTION, tab: state.payload },
        { history: shouldPush ? 'push' : 'replace' },
      )
    },
    [accountState.action, setAccountState],
  )

  const isOpen = accountState.action === ACCOUNT_SETTING_MODAL_ACTION
  const currentTab = (isOpen ? accountState.tab : null) as T | null

  return [{ isOpen, payload: currentTab }, setState] as const
}

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
    }
    catch {
      return value
    }
  },
  serialize: value => JSON.stringify([value]),
})

const parseAsBundleInfo = createParser<BundleInfoQuery>({
  parse: (value) => {
    try {
      const parsed = JSON.parse(value) as Partial<BundleInfoQuery>
      if (parsed
        && typeof parsed.org === 'string'
        && typeof parsed.name === 'string'
        && typeof parsed.version === 'string') {
        return { org: parsed.org, name: parsed.name, version: parsed.version }
      }
    }
    catch {
      return null
    }
    return null
  },
  serialize: value => JSON.stringify(value),
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

/**
 * Utility to clear specific query parameters from URL
 * This is a client-side utility that should be called from client components
 *
 * @param keys - Single key or array of keys to remove from URL
 *
 * @example
 * // In a client component
 * clearQueryParams('param1')
 * clearQueryParams(['param1', 'param2'])
 */
export function clearQueryParams(keys: string | string[]) {
  if (isServer)
    return

  const url = new URL(window.location.href)
  const keysArray = Array.isArray(keys) ? keys : [keys]

  keysArray.forEach(key => url.searchParams.delete(key))

  window.history.replaceState(null, '', url.toString())
}
