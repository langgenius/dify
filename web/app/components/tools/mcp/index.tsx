'use client'
import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import NewMCPCard from './create-card'
import MCPCard from './provider-card'
import MCPDetailPanel from './detail/provider-detail'
import {
  useAllMCPTools,
  useAuthorizeMCP,
  useInvalidateMCPTools,
  useUpdateMCPAuthorizationToken,
  useUpdateMCPTools,
} from '@/service/use-tools'
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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const authCode = searchParams.get('code') || ''
  const providerID = searchParams.get('state') || ''

  const { data: list = [], refetch } = useAllMCPTools()
  const { mutateAsync: authorizeMcp } = useAuthorizeMCP()
  const { mutateAsync: updateTools } = useUpdateMCPTools()
  const invalidateMCPTools = useInvalidateMCPTools()
  const { mutateAsync: updateMCPAuthorizationToken } = useUpdateMCPAuthorizationToken()

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
    await refetch() // update list
    setCurrentProviderID(provider.id)
    await authorizeMcp({
      provider_id: provider.id,
      server_url: provider.server_url!,
    })
    await refetch() // update authorization in list
    await updateTools(provider.id)
    invalidateMCPTools(provider.id)
    await refetch() // update tool list in provider list
  }

  const handleUpdateAuthorization = async (providerID: string, code: string) => {
    const targetProvider = list.find(provider => provider.id === providerID)
    router.replace(pathname)
    if (!targetProvider) return
    await updateMCPAuthorizationToken({
      provider_id: providerID,
      server_url: targetProvider.server_url!,
      authorization_code: code,
    })
    await refetch()
    setCurrentProviderID(providerID)
    await updateTools(providerID)
    invalidateMCPTools(providerID)
    await refetch()
  }

  useEffect(() => {
    if (authCode && providerID && list.length > 0)
      handleUpdateAuthorization(providerID, authCode)
  }, [authCode, providerID, list])

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
            onUpdate={refetch}
          />
        ))}
        {!list.length && renderDefaultCard()}
      </div>
      {currentProvider && (
        <MCPDetailPanel
          detail={currentProvider}
          onHide={() => setCurrentProviderID(undefined)}
          onUpdate={refetch}
        />
      )}
    </>
  )
}
export default MCPList
