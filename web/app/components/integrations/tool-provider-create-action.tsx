'use client'

import type { ToolCategory } from '@/app/components/integrations/routes'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { NewMCPButton } from '@/app/components/tools/mcp/create-card'
import { NewCustomToolButton } from '@/app/components/tools/provider/custom-create-card'

type ToolProviderCreateActionProps = {
  activeTab: ToolCategory
  hasCategoryCollections: boolean
  isCollectionListLoading: boolean
  onCustomToolCreated: () => void
  onMCPProviderCreated: (providerId: string) => void
}

const ToolProviderCreateAction = ({
  activeTab,
  hasCategoryCollections,
  isCollectionListLoading,
  onCustomToolCreated,
  onMCPProviderCreated,
}: ToolProviderCreateActionProps) => {
  if (activeTab === 'mcp')
    return (
      <NewMCPButton
        handleCreate={(provider: ToolWithProvider) => onMCPProviderCreated(provider.id)}
      />
    )

  if (activeTab === 'api' && !isCollectionListLoading && hasCategoryCollections)
    return <NewCustomToolButton onRefreshData={onCustomToolCreated} />

  return null
}

export default ToolProviderCreateAction
