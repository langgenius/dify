'use client'

import type { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useMemo } from 'react'
import { PluginPageContextProvider } from '@/app/components/plugins/plugin-page/context-provider'
import PluginsPanel from '@/app/components/plugins/plugin-page/plugins-panel'

type PluginCategoryPageProps = {
  category: PluginCategoryEnum
}

const PluginCategoryPage = ({
  category,
}: PluginCategoryPageProps) => {
  const initialFilters = useMemo(() => ({
    categories: [category],
    tags: [],
    searchQuery: '',
  }), [category])

  return (
    <PluginPageContextProvider key={category} initialFilters={initialFilters}>
      <div className="flex h-0 grow flex-col overflow-hidden bg-background-body">
        <PluginsPanel />
      </div>
    </PluginPageContextProvider>
  )
}

export default PluginCategoryPage
