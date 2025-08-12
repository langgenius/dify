'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import useSWR from 'swr'

import Button from '@/app/components/base/button'
import { useAppContext } from '@/context/app-context'
import { fetchWorkspaceApiKeys } from '@/service/workspace-api-key'
import type { WorkspaceApiKey } from '@/service/workspace-api-key'
import Item from './item'
import Empty from './empty'
import WorkspaceApiKeyModal from './modal'

export default function WorkspaceApiKeyPage() {
  const { t } = useTranslation()
  const { isCurrentWorkspaceOwner, isCurrentWorkspaceManager } = useAppContext()
  const [showCreateModal, setShowCreateModal] = useState(false)

  const { data, mutate: mutateApiKeys, isLoading: isLoadingApiKeys } = useSWR(
    { url: '/workspaces/current/api-keys' },
    fetchWorkspaceApiKeys,
  )

  if (isLoadingApiKeys) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="border-emphasis/[0.1] border-l-emphasis h-5 w-5 animate-spin rounded-full border-[1.5px]" />
      </div>
    )
  }

  // datasetsパターンと同じようにデータを取得
  const apiKeys = data?.data || []

  return (
    <div>
      {(!apiKeys || apiKeys.length === 0) ? (
        <Empty />
      ) : (
        <div>
          {apiKeys.map((apiKey: WorkspaceApiKey) => (
            <Item
              key={apiKey.id}
              data={apiKey}
              onUpdate={() => mutateApiKeys()}
            />
          ))}
        </div>
      )}

      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => setShowCreateModal(true)}
        disabled={!isCurrentWorkspaceOwner && !isCurrentWorkspaceManager}
      >
        <RiAddLine className="mr-1 h-4 w-4" />
        {t('common.workspaceApiKey.add')}
      </Button>

      {showCreateModal && (
        <WorkspaceApiKeyModal
          data={{}}
          onCancel={() => setShowCreateModal(false)}
          onSave={() => {
            setShowCreateModal(false)
            mutateApiKeys()
          }}
        />
      )}
    </div>
  )
}
