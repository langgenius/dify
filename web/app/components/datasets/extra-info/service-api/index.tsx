import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  API_KEY_LIMIT,
  ApiKeyCreateAction,
  ApiKeyDialogContent,
} from '@/app/components/api-key/api-key-dialog-content'
import { ApiKeyListContent } from '@/app/components/api-key/api-key-list-content'
import { CreatedApiKeyDialog } from '@/app/components/api-key/created-api-key-dialog'
import { DatasetScopeDialog } from '@/app/components/api-key/dataset-scope-dialog'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import { ServiceApiCard } from './card'

type ServiceApiProps = {
  apiBaseUrl: string
}

export function ServiceApi({ apiBaseUrl }: ServiceApiProps) {
  const { t } = useTranslation(['dataset', 'appApi'])
  const triggerRef = useRef<HTMLButtonElement>(null)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageApiKey = hasPermission(workspacePermissionKeys, 'dataset.api_key.manage')
  const createKey = useMutation(consoleQuery.datasets.apiKeys.post.mutationOptions())
  const deleteKey = useMutation(consoleQuery.datasets.apiKeys.byApiKeyId.delete.mutationOptions())
  const pending = createKey.isPending || deleteKey.isPending

  return (
    <div className="flex items-center">
      <Dialog
        onOpenChange={(open, details) => {
          if (!open && pending) details.cancel()
        }}
      >
        <Popover>
          <PopoverTrigger
            ref={triggerRef}
            render={(props) => (
              <button
                {...props}
                type="button"
                className={cn(
                  'relative flex h-6 w-full cursor-pointer items-center justify-center gap-1 overflow-hidden rounded-md border-none bg-transparent px-1.5 py-1 text-left text-text-tertiary hover:bg-state-base-hover data-popup-open:bg-state-base-hover',
                  props.className,
                )}
              >
                <StatusDot className="shrink-0" status={apiBaseUrl ? 'success' : 'warning'} />
                <div className="px-0.5 system-xs-medium">
                  {t(($) => $['serviceApi.title'], { ns: 'dataset' })}
                </div>
              </button>
            )}
          />
          <PopoverContent
            placement="top-start"
            sideOffset={4}
            alignOffset={-4}
            className="border-none bg-transparent shadow-none"
          >
            <ServiceApiCard apiBaseUrl={apiBaseUrl} canManageApiKey={canManageApiKey} />
          </PopoverContent>
        </Popover>
        <ApiKeyDialogContent
          limitDescription={t(($) => $['apiKeyModal.workspaceKeyLimit'], {
            ns: 'appApi',
            limit: API_KEY_LIMIT,
          })}
          closeDisabled={pending}
          finalFocus={triggerRef}
        >
          <DatasetApiKeys
            canManage={canManageApiKey}
            isCreating={createKey.isPending}
            isDeleting={deleteKey.isPending}
            createdKey={createKey.data?.token}
            onCreate={(datasetIds, onSuccess) => {
              if (!canManageApiKey || pending) return
              createKey.mutate({ body: { dataset_ids: datasetIds } }, { onSuccess })
            }}
            onDelete={(keyId, onSuccess) => {
              if (!canManageApiKey || pending) return
              deleteKey.mutate({ params: { api_key_id: keyId } }, { onSuccess })
            }}
          />
        </ApiKeyDialogContent>
      </Dialog>
    </div>
  )
}

type DatasetApiKeysProps = Pick<
  ComponentProps<typeof ApiKeyListContent>,
  'canManage' | 'isDeleting' | 'onDelete'
> & {
  isCreating: boolean
  createdKey: string | undefined
  onCreate: (datasetIds: string[], onSuccess: () => void) => void
}

function DatasetApiKeys({
  canManage,
  isCreating,
  isDeleting,
  createdKey,
  onCreate,
  onDelete,
}: DatasetApiKeysProps) {
  const keys = useSuspenseQuery(consoleQuery.datasets.apiKeys.get.queryOptions())
  const [scopeOpen, setScopeOpen] = useState(false)
  const [createdOpen, setCreatedOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const createDisabled =
    !canManage || !keys.isSuccess || keys.isFetching || keys.data.data.length >= API_KEY_LIMIT
  return (
    <ApiKeyListContent
      apiKeys={keys.data.data}
      canManage={canManage}
      showScope
      isDeleting={isDeleting}
      isFetching={keys.isFetching}
      isError={keys.isError}
      onRetry={() => {
        void keys.refetch()
      }}
      onDelete={onDelete}
      finalFocus={createButtonRef}
    >
      <ApiKeyCreateAction
        ref={createButtonRef}
        count={keys.data.data.length}
        limit={API_KEY_LIMIT}
        disabled={createDisabled}
        focusableWhenDisabled={canManage}
        loading={isCreating}
        onClick={() => setScopeOpen(true)}
      />
      <CreatedApiKeyDialog
        open={createdOpen}
        onOpenChange={setCreatedOpen}
        value={createdKey}
        revealOnce
        finalFocus={createButtonRef}
      />
      <DatasetScopeDialog
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        isCreating={isCreating}
        createDisabled={createDisabled}
        finalFocus={() => (createdOpen ? false : createButtonRef.current)}
        onConfirm={(datasetIds) => {
          if (createDisabled || isCreating) return
          onCreate(datasetIds, () => {
            setCreatedOpen(true)
            setScopeOpen(false)
          })
        }}
      />
    </ApiKeyListContent>
  )
}
