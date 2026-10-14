'use client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  API_KEY_LIMIT,
  ApiKeyCreateAction,
  ApiKeyDialogContent,
} from '@/app/components/api-key/api-key-dialog-content'
import { ApiKeyListContent } from '@/app/components/api-key/api-key-list-content'
import { CreatedApiKeyDialog } from '@/app/components/api-key/created-api-key-dialog'
import { consoleQuery } from '@/service/console'

type AgentApiKeyDialogContentProps = {
  agentId: string
  canManage: boolean
  isCreating: boolean
  isDeleting: boolean
  createdKey: string | undefined
  onCreate: (onSuccess: () => void) => void
  onDelete: (keyId: string, onSuccess: () => void) => void
}

export function AgentApiKeyDialogContent(props: AgentApiKeyDialogContentProps) {
  const { t } = useTranslation(['appApi'])
  return (
    <ApiKeyDialogContent
      closeDisabled={props.isCreating || props.isDeleting}
      limitDescription={t(($) => $['apiKeyModal.keyLimit'], { limit: API_KEY_LIMIT })}
    >
      <AgentApiKeys {...props} />
    </ApiKeyDialogContent>
  )
}

function AgentApiKeys({
  agentId,
  canManage,
  isCreating,
  isDeleting,
  createdKey,
  onCreate,
  onDelete,
}: AgentApiKeyDialogContentProps) {
  const keys = useSuspenseQuery(
    consoleQuery.agent.byAgentId.apiKeys.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )
  const [createdOpen, setCreatedOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const createDisabled =
    !canManage || !keys.isSuccess || keys.isFetching || keys.data.data.length >= API_KEY_LIMIT
  return (
    <ApiKeyListContent
      apiKeys={keys.data.data}
      canManage={canManage}
      allowCopy
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
        onClick={() => {
          if (createDisabled || isCreating) return
          onCreate(() => setCreatedOpen(true))
        }}
      />
      <CreatedApiKeyDialog
        open={createdOpen}
        onOpenChange={setCreatedOpen}
        value={createdKey}
        finalFocus={createButtonRef}
      />
    </ApiKeyListContent>
  )
}
