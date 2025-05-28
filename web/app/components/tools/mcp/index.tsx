'use client'
import { useMemo, useState } from 'react'
import NewMCPCard from './create-card'
import MCPCard from './provider-card'
import MCPDetailPanel from './detail/provider-detail'
import { useAllMCPTools, useAuthorizeMCP, useInvalidateAllMCPTools, useInvalidateMCPTools, useUpdateMCPTools } from '@/service/use-tools'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

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
    ></div>
  ))
  return defaultCards
}

const MCPList = ({
  searchText,
}: Props) => {
  const { data: list = [] } = useAllMCPTools()
  const invalidateMCPList = useInvalidateAllMCPTools()
  const { mutateAsync: authorizeMcp } = useAuthorizeMCP()
  const { mutateAsync: updateTools } = useUpdateMCPTools()
  const invalidateMCPTools = useInvalidateMCPTools()

  const filteredList = useMemo(() => {
    return list.filter((collection) => {
      if (searchText)
        return Object.values(collection.name).some(value => (value as string).toLowerCase().includes(searchText.toLowerCase()))
      return true
    })
  }, [list, searchText])

  const [currentProviderID, setCurrentProviderID] = useState<string>()

  const currentProvider = useMemo(() => {
    return list.find(provider => provider.id === currentProviderID)
  }, [list, currentProviderID])

  const handleCreate = async (provider: ToolWithProvider) => {
    invalidateMCPList()
    setCurrentProviderID(provider.id)
    await authorizeMcp({
      provider_id: provider.id,
      server_url: provider.server_url!,
    })
    await updateTools(provider.id)
    invalidateMCPTools(provider.id)
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
            currentProvider={currentProvider}
            handleSelect={setCurrentProviderID}
            onUpdate={() => invalidateMCPList()}
          />
        ))}
        {!list.length && renderDefaultCard()}
      </div>
      {currentProvider && (
        <MCPDetailPanel
          detail={currentProvider}
          onHide={() => setCurrentProviderID(undefined)}
          onUpdate={() => invalidateMCPList()}
        />
      )}
    </>
  )
}
export default MCPList
