'use client'
import type { ToolsContentInset } from '../content-inset'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useMemo, useState } from 'react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { useCanManageMCP } from '@/app/components/tools/hooks/use-tool-permissions'
import ToolCardSkeletonGrid from '@/app/components/tools/provider/tool-card-skeleton'
import {
  useAllToolProviders,
} from '@/service/use-tools'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from '../content-inset'
import NewMCPCard from './create-card'
import MCPDetailPanel from './detail/provider-detail'
import MCPCard from './provider-card'

type Props = Readonly<{
  searchText: string
  contentInset?: ToolsContentInset
  createdProviderId?: string
  onCreatedProviderHandled?: () => void
  showCreateCard?: boolean
}>

const MCPList = ({
  searchText,
  contentInset = 'default',
  createdProviderId,
  onCreatedProviderHandled,
  showCreateCard = true,
}: Props) => {
  const canManageMCP = useCanManageMCP()
  const { data: list = [] as ToolWithProvider[], isLoading, refetch } = useAllToolProviders()
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
    if (!canManageMCP)
      return

    await refetch() // update list
    setCurrentProviderID(provider.id)
    setIsTriggerAuthorize(true)
  }

  useEffect(() => {
    if (!canManageMCP || !createdProviderId)
      return

    let isActive = true

    const openCreatedProvider = async () => {
      try {
        await refetch()
        if (!isActive)
          return

        setCurrentProviderID(createdProviderId)
        setIsTriggerAuthorize(true)
      }
      finally {
        if (isActive)
          onCreatedProviderHandled?.()
      }
    }

    void openCreatedProvider()

    return () => {
      isActive = false
    }
  }, [canManageMCP, createdProviderId, onCreatedProviderHandled, refetch])

  const handleUpdate = async (providerID: string) => {
    if (!canManageMCP)
      return

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
          isLoading && 'h-[calc(100vh-136px)] overflow-hidden',
        )}
      >
        {!isLoading && canManageMCP && showCreateCard && <NewMCPCard handleCreate={handleCreate} />}
        {isLoading
          ? <ToolCardSkeletonGrid variant="mcp" />
          : filteredList.map((provider, index) => (
              <div
                key={provider.id}
                data-step-by-step-tour-target={index === 0 ? STEP_BY_STEP_TOUR_TARGETS.integrationMcpFirstCard : undefined}
              >
                <MCPCard
                  data={provider}
                  currentProvider={currentProvider as ToolWithProvider}
                  handleSelect={setCurrentProviderID}
                  onUpdate={handleUpdate}
                  onDeleted={refetch}
                />
              </div>
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
