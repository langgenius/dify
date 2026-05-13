'use client'
import type { ToolsContentInset } from '../content-inset'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo, useState } from 'react'
import {
  useAllToolProviders,
} from '@/service/use-tools'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from '../content-inset'
import NewMCPCard from './create-card'
import MCPDetailPanel from './detail/provider-detail'
import MCPCard from './provider-card'

type Props = {
  searchText: string
  contentInset?: ToolsContentInset
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
  contentInset = 'default',
}: Props) => {
  const { data: list = [] as ToolWithProvider[], refetch } = useAllToolProviders()
  const [isTriggerAuthorize, setIsTriggerAuthorize] = useState<boolean>(false)

  const filteredList = useMemo(() => {
    return list.filter((collection) => {
      if (collection.type !== 'mcp')
        return false
      if (searchText)
        return Object.values(collection.name).some(value => (value as string).toLowerCase().includes(searchText.toLowerCase()))
      return true
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
  const contentPaddingClassName = toolsContentInsetClassNames[contentInset]
  const contentFrameClassName = cn(contentPaddingClassName, toolsUnifiedContentFrameClassName)
  return (
    <>
      <div
        className={cn(
          'relative grid shrink-0 grid-cols-1 content-start gap-4 pt-2 pb-4 sm:grid-cols-2 md:grid-cols-3',
          contentFrameClassName,
          !list.length && 'h-[calc(100vh-136px)] overflow-hidden',
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
