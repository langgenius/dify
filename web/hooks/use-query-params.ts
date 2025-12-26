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

import type { Options } from 'nuqs'
import {

  parseAsArrayOf,
  parseAsString,
  useQueryState,
  useQueryStates,
} from 'nuqs'
import { ACCOUNT_SETTING_MODAL_ACTION } from '@/app/components/header/account-setting/constants'

/**
 * Modal State Query Parameters
 * Manages modal visibility and configuration via URL
 */
export const PRICING_MODAL_QUERY_PARAM = 'pricing'
export const PRICING_MODAL_QUERY_VALUE = 'open'

/**
 * Hook to manage pricing modal state via URL
 * @returns [isOpen, setIsOpen] - Tuple like useState
 *
 * @example
 * const [isPricingModalOpen, setIsPricingModalOpen] = usePricingModal()
 * setIsPricingModalOpen(true) // Sets ?pricing=open
 * setIsPricingModalOpen(false) // Removes ?pricing
 */
export function usePricingModal() {
  const [isOpen, setIsOpen] = useQueryState(
    PRICING_MODAL_QUERY_PARAM,
    parseAsString,
  )

  const setIsOpenBoolean = (open: boolean, options?: Options) => {
    const history = options?.history ?? (open ? 'push' : 'replace')
    setIsOpen(open ? PRICING_MODAL_QUERY_VALUE : null, { ...options, history })
  }

  return [isOpen === PRICING_MODAL_QUERY_VALUE, setIsOpenBoolean] as const
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

  const setState = (state: { payload: T } | null) => {
    if (!state) {
      setAccountState({ action: null, tab: null }, { history: 'replace' })
      return
    }
    const shouldPush = accountState.action !== ACCOUNT_SETTING_MODAL_ACTION
    setAccountState(
      { action: ACCOUNT_SETTING_MODAL_ACTION, tab: state.payload },
      { history: shouldPush ? 'push' : 'replace' },
    )
  }

  const isOpen = accountState.action === ACCOUNT_SETTING_MODAL_ACTION
  const currentTab = (isOpen ? accountState.tab : null) as T | null

  return [{ isOpen, payload: currentTab }, setState] as const
}

/**
 * Marketplace Search Query Parameters
 */
export type MarketplaceFilters = {
  q: string // search query
  category: string // plugin category
  tags: string[] // comma-separated tags
}

/**
 * Hook to manage marketplace search/filter state via URL
 * Provides atomic updates - all params update together
 *
 * @example
 * const [filters, setFilters] = useMarketplaceFilters()
 * setFilters({ q: 'search', category: 'tool', tags: ['ai'] }) // Updates all at once
 * setFilters({ q: '' }) // Only updates q, keeps others
 * setFilters(null) // Clears all marketplace params
 */
export function useMarketplaceFilters() {
  return useQueryStates(
    {
      q: parseAsString.withDefault(''),
      category: parseAsString.withDefault('all').withOptions({ clearOnDefault: false }),
      tags: parseAsArrayOf(parseAsString).withDefault([]),
    },
    {
      // Update URL without pushing to history (replaceState behavior)
      history: 'replace',
    },
  )
}

/**
 * Plugin Installation Query Parameters
 */
const PACKAGE_IDS_PARAM = 'package-ids'
const BUNDLE_INFO_PARAM = 'bundle-info'

/**
 * Hook to manage plugin installation state via URL
 * @returns [installState, setInstallState] - Installation state and setter
 *
 * @example
 * const [installState, setInstallState] = usePluginInstallation()
 * setInstallState({ packageId: 'org/plugin' }) // Sets ?package-ids=["org/plugin"]
 * setInstallState(null) // Clears installation params
 */
export function usePluginInstallation() {
  const [packageIds, setPackageIds] = useQueryState(
    PACKAGE_IDS_PARAM,
    parseAsString,
  )
  const [bundleInfo, setBundleInfo] = useQueryState(
    BUNDLE_INFO_PARAM,
    parseAsString,
  )

  const setInstallState = (state: { packageId?: string, bundleInfo?: string } | null) => {
    if (!state) {
      setPackageIds(null)
      setBundleInfo(null)
      return
    }
    if (state.packageId) {
      // Store as JSON array for consistency with existing code
      setPackageIds(JSON.stringify([state.packageId]))
    }
    if (state.bundleInfo) {
      setBundleInfo(state.bundleInfo)
    }
  }

  // Parse packageIds from JSON array
  const currentPackageId = packageIds
    ? (() => {
        try {
          const parsed = JSON.parse(packageIds)
          return Array.isArray(parsed) ? parsed[0] : packageIds
        }
        catch {
          return packageIds
        }
      })()
    : null

  return [
    {
      packageId: currentPackageId,
      bundleInfo,
    },
    setInstallState,
  ] as const
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
  if (typeof window === 'undefined')
    return

  const url = new URL(window.location.href)
  const keysArray = Array.isArray(keys) ? keys : [keys]

  keysArray.forEach(key => url.searchParams.delete(key))

  window.history.replaceState(null, '', url.toString())
}
