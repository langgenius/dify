'use client'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useMemo, useState } from 'react'
import {
  useAllToolProviders,
} from '@/service/use-tools'
import { cn } from '@/utils/classnames'
import NewMCPCard from './create-card'
import MCPDetailPanel from './detail/provider-detail'
import MCPCard from './provider-card'

type Props = {
  searchText: string
}

function renderDefaultCard() {
  const defaultCards = Array.from({ length: 36 }, (_, index) => (
    <div
      key={index}
      className={cn(
        'inline-flex h-[111px] rounded-xl bg-background-default-lighter opacity-10',
        index < 4 && 'opacity-60',
        index >= 4 && index < 8 && 'opacity-50',
        index >= 8 && index < 12 && 'opacity-40',
        index >= 12 && index < 16 && 'opacity-30',
        index >= 16 && index < 20 && 'opacity-25',
        index >= 20 && index < 24 && 'opacity-20',
      )}
    >
    </div>
  ))
  return defaultCards
}

const MCPList = ({
  searchText,
}: Props) => {
  const { data: list = [] as ToolWithProvider[], refetch } = useAllToolProviders()
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
          'relative grid shrink-0 grid-cols-1 content-start gap-4 px-12 pb-4 pt-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 2k:grid-cols-6',
          !list.length && 'h-[calc(100vh_-_136px)] overflow-hidden',
        )}
      >
        <NewMCPCard handleCreate={handleCreate} />
        {filteredList.map(provider => (
          <MCPCard
            key={provider.id}
            data={provider}
            currentProvider={currentProvider as ToolWithProvider}
            handleSelect={setCurrentProviderID}
            onUpdate={handleUpdate}
            onDeleted={refetch}
          />
        ))}
        {!list.length && renderDefaultCard()}
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
