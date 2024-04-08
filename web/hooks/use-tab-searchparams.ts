import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

type UseTabSearchParamsOptions = {
  defaultTab: string
  routingBehavior?: 'push' | 'replace'
  searchParamName?: string
  disableSearchParams?: boolean
}

/**
 * Custom hook to manage tab state via URL search parameters in a Next.js application.
 * This hook allows for syncing the active tab with the browser's URL, enabling bookmarking and sharing of URLs with a specific tab activated.
 *
 * @param {UseTabSearchParamsOptions} options Configuration options for the hook:
 * - `defaultTab`: The tab to default to when no tab is specified in the URL.
 * - `routingBehavior`: Optional. Determines how changes to the active tab update the browser's history ('push' or 'replace'). Default is 'push'.
 * - `searchParamName`: Optional. The name of the search parameter that holds the tab state in the URL. Default is 'category'.
 * @returns A tuple where the first element is the active tab and the second element is a function to set the active tab.
 */
export const useTabSearchParams = ({
  defaultTab,
  routingBehavior = 'push',
  searchParamName = 'category',
  disableSearchParams = false,
}: UseTabSearchParamsOptions) => {
  const router = useRouter()
  const pathName = usePathname()
  const searchParams = useSearchParams()
  const [activeTab, setTab] = useState<string>(
    !disableSearchParams
      ? (searchParams.get(searchParamName) || defaultTab)
      : defaultTab,
  )

  const setActiveTab = (newActiveTab: string) => {
    setTab(newActiveTab)
    if (disableSearchParams)
      return
    router[routingBehavior](`${pathName}?${searchParamName}=${newActiveTab}`)
  }

  return [activeTab, setActiveTab] as const
}
