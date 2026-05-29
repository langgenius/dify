'use client'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo, useState } from 'react'
import ToolCardSkeletonGrid from '@/app/components/tools/provider/tool-card-skeleton'
import {
  useAllToolProviders,
} from '@/service/use-tools'
import NewMCPCard from './create-card'
import MCPDetailPanel from './detail/provider-detail'
import MCPCard from './provider-card'

type Props = {
  searchText: string
}

const MCPList = ({
  searchText,
}: Props) => {
  const { data: list = [] as ToolWithProvider[], isLoading, refetch } = useAllToolProviders()
  const [isTriggerAuthorize, setIsTriggerAuthorize] = useState<boolean>(false)

  const filteredList = useMemo(() => {
    return list.filter((collection) => {
      if (searchText)
        return Object.values(collection.name).some(value => (value as string).toLowerCase().includes(searchText.toLowerCase()))
      return collection.type === 'mcp'
    }) as ToolWithProvider[]
  }, [list, searchText])

  const [currentProviderID, setCurrentProviderID] = useState<string>()

  const currentProvider = useMemo(() => {
    return list.find(provider => provider.id === currentProviderID)
  }, [list, currentProviderID])

  const handleCreate = async (provider: ToolWithProvider) => {
    await refetch() // update list
    setCurrentProviderID(provider.id)
    setIsTriggerAuthorize(true)
  }

  const handleUpdate = async (providerID: string) => {
    await refetch() // update list
    setCurrentProviderID(providerID)
    setIsTriggerAuthorize(true)
  }
  return (
    <>
      <div
        className={cn(
          'relative grid shrink-0 grid-cols-1 content-start gap-4 px-12 pt-2 pb-4 2k:grid-cols-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5',
          isLoading && 'h-[calc(100vh-136px)] overflow-hidden',
        )}
      >
        <NewMCPCard handleCreate={handleCreate} />
        {isLoading
          ? <ToolCardSkeletonGrid />
          : filteredList.map(provider => (
              <MCPCard
                key={provider.id}
                data={provider}
                currentProvider={currentProvider as ToolWithProvider}
                handleSelect={setCurrentProviderID}
                onUpdate={handleUpdate}
                onDeleted={refetch}
              />
            ))}
      </div>
      {currentProvider && (
        <MCPDetailPanel
          detail={currentProvider as ToolWithProvider}
          onHide={() => setCurrentProviderID(undefined)}
          onUpdate={refetch}
          isTriggerAuthorize={isTriggerAuthorize}
          onFirstCreate={() => setIsTriggerAuthorize(false)}
        />
      )}
    </>
  )
}
export default MCPList
