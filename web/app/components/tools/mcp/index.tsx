'use client'
import type { ComponentProps } from 'react'
import type { ToolsContentInset } from '../content-inset'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { useCanManageMCP } from '@/app/components/tools/hooks/use-tool-permissions'
import ToolCardSkeletonGrid from '@/app/components/tools/provider/tool-card-skeleton'
import { useAllMCPTools, useDeleteMCP, useUpdateMCP } from '@/service/use-tools'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from '../content-inset'
import NewMCPCard from './create-card'
import MCPDetailPanel from './detail/provider-detail'
import MCPModal from './modal'
import MCPCard from './provider-card'

type Props = Readonly<{
  providers?: ToolWithProvider[]
  isLoading?: boolean
  searchText: string
  contentInset?: ToolsContentInset
  createdProviderId?: string
  onRefresh?: () => Promise<unknown>
  onCreatedProviderHandled?: () => void
  showCreateCard?: boolean
}>

type MCPModalConfirmPayload = Parameters<ComponentProps<typeof MCPModal>['onConfirm']>[0]
type MutationResult = {
  result?: string
}
const EMPTY_MCP_TOOLS: ToolWithProvider[] = []

const MCPList = ({
  providers,
  isLoading: isLoadingProviders,
  searchText,
  contentInset = 'default',
  createdProviderId,
  onRefresh,
  onCreatedProviderHandled,
  showCreateCard = true,
}: Props) => {
  const { t } = useTranslation()
  const canManageMCP = useCanManageMCP()
  const fallbackMCPToolsQuery = useAllMCPTools(providers === undefined)
  const list = providers ?? fallbackMCPToolsQuery.data ?? EMPTY_MCP_TOOLS
  const isLoading = isLoadingProviders ?? fallbackMCPToolsQuery.isLoading
  const refetch = onRefresh ?? fallbackMCPToolsQuery.refetch
  const [isTriggerAuthorize, setIsTriggerAuthorize] = useState<boolean>(false)

  const filteredList = useMemo(() => {
    return list.filter((collection) => {
      if (collection.type !== 'mcp') return false
      if (searchText) return collection.name.toLowerCase().includes(searchText.toLowerCase())
      return true
    }) as ToolWithProvider[]
  }, [list, searchText])

  const [currentProviderID, setCurrentProviderID] = useState<string>()
  const [editingProviderID, setEditingProviderID] = useState<string>()
  const [deletingProviderID, setDeletingProviderID] = useState<string>()

  const currentProvider = list.find((provider) => provider.id === currentProviderID)
  const editingProvider = list.find((provider) => provider.id === editingProviderID)
  const deletingProvider = list.find((provider) => provider.id === deletingProviderID)
  const detailProvider = editingProvider || deletingProvider ? undefined : currentProvider
  const { mutateAsync: updateMCP } = useUpdateMCP({})
  const { mutateAsync: deleteMCP, isPending: isDeleting } = useDeleteMCP({})

  const handleCreate = async (provider: ToolWithProvider) => {
    if (!canManageMCP) return

    await refetch() // update list
    setCurrentProviderID(provider.id)
    setIsTriggerAuthorize(true)
  }

  useEffect(() => {
    if (!canManageMCP || !createdProviderId) return

    let isActive = true

    const openCreatedProvider = async () => {
      try {
        await refetch()
        if (!isActive) return

        setCurrentProviderID(createdProviderId)
        setIsTriggerAuthorize(true)
      } finally {
        if (isActive) onCreatedProviderHandled?.()
      }
    }

    void openCreatedProvider()

    return () => {
      isActive = false
    }
  }, [canManageMCP, createdProviderId, onCreatedProviderHandled, refetch])

  const handleEdit = (providerID: string) => {
    if (!canManageMCP) return

    setEditingProviderID(providerID)
  }

  const handleEditConfirm = async (form: MCPModalConfirmPayload) => {
    if (!canManageMCP || !editingProvider) return

    const res = (await updateMCP({
      ...form,
      provider_id: editingProvider.id,
    })) as MutationResult
    if (res.result !== 'success') return

    await refetch() // update list
    setCurrentProviderID(editingProvider.id)
    setIsTriggerAuthorize(true)
    setEditingProviderID(undefined)
  }

  const handleDelete = (providerID: string) => {
    if (!canManageMCP) return

    setDeletingProviderID(providerID)
  }

  const handleDeleteConfirm = async () => {
    if (!canManageMCP || !deletingProvider) return

    const res = (await deleteMCP(deletingProvider.id)) as MutationResult
    if (res.result !== 'success') return

    await refetch()
    setCurrentProviderID(undefined)
    setDeletingProviderID(undefined)
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
        {isLoading ? (
          <ToolCardSkeletonGrid variant="mcp" />
        ) : (
          filteredList.map((provider, index) => (
            <div
              key={provider.id}
              data-step-by-step-tour-target={
                index === 0 ? STEP_BY_STEP_TOUR_TARGETS.integrationMcpFirstCard : undefined
              }
            >
              <MCPCard
                data={provider}
                currentProvider={detailProvider as ToolWithProvider}
                handleSelect={setCurrentProviderID}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            </div>
          ))
        )}
      </div>
      {detailProvider && (
        <MCPDetailPanel
          detail={detailProvider as ToolWithProvider}
          onHide={() => setCurrentProviderID(undefined)}
          onUpdate={refetch}
          onEdit={handleEdit}
          onDelete={handleDelete}
          isTriggerAuthorize={isTriggerAuthorize}
          onFirstCreate={() => setIsTriggerAuthorize(false)}
        />
      )}
      {editingProvider && (
        <MCPModal
          data={editingProvider as ToolWithProvider}
          show
          onConfirm={handleEditConfirm}
          onHide={() => setEditingProviderID(undefined)}
        />
      )}
      {deletingProvider && (
        <AlertDialog open onOpenChange={(open) => !open && setDeletingProviderID(undefined)}>
          <AlertDialogContent>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                {t(($) => $['mcp.delete'], { ns: 'tools' })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {t(($) => $['mcp.deleteConfirmTitle'], { ns: 'tools', mcp: deletingProvider.name })}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                loading={isDeleting}
                disabled={isDeleting}
                onClick={handleDeleteConfirm}
              >
                {t(($) => $['operation.confirm'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogActions>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
export default MCPList
