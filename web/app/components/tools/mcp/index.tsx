'use client'
import type { ComponentProps } from 'react'
import type { ToolsContentInset } from '../content-inset'
import type { Collection } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { useCanManageMCP } from '@/app/components/tools/hooks/use-tool-permissions'
import ToolCardSkeletonGrid from '@/app/components/tools/provider/tool-card-skeleton'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryErrors } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { toolsContentInsetClassNames, toolsUnifiedContentFrameClassName } from '../content-inset'
import { selectToolsWithProvider } from '../utils/query-select'
import NewMCPCard from './create-card'
import MCPDetailPanel from './detail/provider-detail'
import MCPModal from './modal'
import MCPCard from './provider-card'

type Props = Readonly<{
  providers?: Collection[]
  isLoading?: boolean
  searchText: string
  contentInset?: ToolsContentInset
  createdProviderId?: string
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
  onCreatedProviderHandled,
  showCreateCard = true,
}: Props) => {
  const { t } = useTranslation(['common', 'tools'])
  const canManageMCP = useCanManageMCP()
  const fallbackMCPToolsQuery = useQuery(
    consoleQuery.workspaces.current.tools.mcp.get.queryOptions({
      enabled: providers === undefined,
      select: selectToolsWithProvider,
    }),
  )
  const list = providers ?? fallbackMCPToolsQuery.data ?? EMPTY_MCP_TOOLS
  const isLoading = isLoadingProviders ?? fallbackMCPToolsQuery.isLoading
  // Only the list's own lookup is presented here; a caller passing `providers` owns its failures.
  const fallbackToolsLoad = useOwnedQueryErrors(
    providers === undefined ? [fallbackMCPToolsQuery] : [],
  )
  const loadErrorMessage = useRequestErrorMessage(fallbackToolsLoad?.error)
  const queryClient = useQueryClient()
  // Refreshes the catalogs after a provider is opened from elsewhere or its tools are fetched.
  const refreshProviders = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.toolProviders.get.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.tools.mcp.get.key(),
        }),
      ]),
    [queryClient],
  )
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
  const { mutateAsync: updateMCP } = useMutation(
    consoleQuery.workspaces.current.toolProvider.mcp.put.mutationOptions(),
  )
  const { mutateAsync: deleteMCP, isPending: isDeleting } = useMutation(
    consoleQuery.workspaces.current.toolProvider.mcp.delete.mutationOptions(),
  )

  const handleCreate = (provider: ToolWithProvider) => {
    if (!canManageMCP) return

    setCurrentProviderID(provider.id)
    setIsTriggerAuthorize(true)
  }

  useEffect(() => {
    if (!canManageMCP || !createdProviderId) return

    let isActive = true

    const openCreatedProvider = async () => {
      try {
        await refreshProviders()
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
  }, [canManageMCP, createdProviderId, onCreatedProviderHandled, refreshProviders])

  const handleEdit = (providerID: string) => {
    if (!canManageMCP) return

    setEditingProviderID(providerID)
  }

  const handleEditConfirm = async (form: MCPModalConfirmPayload) => {
    if (!canManageMCP || !editingProvider) return

    const res = (await updateMCP({
      body: { ...form, provider_id: editingProvider.id },
    })) as MutationResult
    if (res.result !== 'success') return

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

    const res = (await deleteMCP({
      body: { provider_id: deletingProvider.id },
    })) as MutationResult
    if (res.result !== 'success') return

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
        {fallbackToolsLoad && loadErrorMessage && (
          <Alert type="error" className="col-span-full">
            <AlertTitle>{loadErrorMessage}</AlertTitle>
            <AlertActions>
              <Button
                size="small"
                loading={fallbackToolsLoad.retrying}
                onClick={fallbackToolsLoad.retry}
              >
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            </AlertActions>
          </Alert>
        )}
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
          onUpdate={refreshProviders}
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
            <AlertDialogHeader>
              <AlertDialogTitle>{t(($) => $['mcp.delete'], { ns: 'tools' })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(($) => $['mcp.deleteConfirmTitle'], { ns: 'tools', mcp: deletingProvider.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancelButton>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton loading={isDeleting} onClick={handleDeleteConfirm}>
                {t(($) => $['operation.confirm'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
export default MCPList
