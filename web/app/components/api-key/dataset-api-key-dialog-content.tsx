'use client'

import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { ComponentProps } from 'react'
import type { DatasetApiKeyScopeSelection } from './dataset-scope-dialog'
import type { useDatasetApiKeyMutations } from './use-dataset-api-key-mutations'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { API_KEY_LIMIT, ApiKeyCreateAction, ApiKeyDialogContent } from './api-key-dialog-content'
import { ApiKeyListContent } from './api-key-list-content'
import { CreatedApiKeyDialog } from './created-api-key-dialog'
import { DatasetScopeDialog } from './dataset-scope-dialog'

type DatasetApiKeyDialogContentProps = Pick<DialogContentProps, 'finalFocus'> & {
  canManage: boolean
  mutations: ReturnType<typeof useDatasetApiKeyMutations>
}

// Workspace dataset API keys. The caller owns the Dialog root so it can keep its own trigger
// and cancel closing while `mutations.pending`.
export function DatasetApiKeyDialogContent({
  canManage,
  mutations: { createKey, deleteKey, pending },
  finalFocus,
}: DatasetApiKeyDialogContentProps) {
  const { t } = useTranslation(['appApi'])
  return (
    <ApiKeyDialogContent
      limitDescription={t(($) => $['apiKeyModal.workspaceKeyLimit'], {
        ns: 'appApi',
        limit: API_KEY_LIMIT,
      })}
      closeDisabled={pending}
      finalFocus={finalFocus}
    >
      <DatasetApiKeys
        canManage={canManage}
        isCreating={createKey.isPending}
        isDeleting={deleteKey.isPending}
        createdKey={createKey.data?.token}
        onCreate={({ datasetIds, knowledgeSpaceIds }, onSuccess) => {
          if (!canManage || pending) return
          // Legacy datasets and KnowledgeFS spaces are bound separately; both empty = all access.
          createKey.mutate(
            { body: { dataset_ids: datasetIds, knowledge_space_ids: knowledgeSpaceIds } },
            { onSuccess },
          )
        }}
        onDelete={(keyId, onSuccess) => {
          if (!canManage || pending) return
          deleteKey.mutate({ params: { api_key_id: keyId } }, { onSuccess })
        }}
      />
    </ApiKeyDialogContent>
  )
}

type DatasetApiKeysProps = Pick<
  ComponentProps<typeof ApiKeyListContent>,
  'canManage' | 'isDeleting' | 'onDelete'
> & {
  isCreating: boolean
  createdKey: string | undefined
  onCreate: (selection: DatasetApiKeyScopeSelection, onSuccess: () => void) => void
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
  const atLimit = keys.data.data.length >= API_KEY_LIMIT
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
        atLimit={atLimit}
        disabled={!canManage}
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
        createDisabled={!canManage || atLimit}
        finalFocus={() => (createdOpen ? false : createButtonRef.current)}
        onConfirm={(selection) =>
          onCreate(selection, () => {
            setCreatedOpen(true)
            setScopeOpen(false)
          })
        }
      />
    </ApiKeyListContent>
  )
}
