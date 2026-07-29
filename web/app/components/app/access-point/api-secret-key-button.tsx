'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SecretKeyModal from '@/app/components/develop/secret-key/secret-key-modal'
import { useAppApiKeys } from '@/service/use-apps'

type ApiSecretKeyButtonProps = {
  appId: string
  canManage: boolean
  disabled?: boolean
}

export function ApiSecretKeyButton({
  appId,
  canManage,
  disabled = false,
}: ApiSecretKeyButtonProps) {
  const { t } = useTranslation()
  const [modalOpen, setModalOpen] = useState(false)
  const apiKeysQuery = useAppApiKeys(appId)
  const apiKeyCount = apiKeysQuery.data?.data.length ?? 0
  const buttonDisabled = disabled || !canManage || apiKeysQuery.isPending || apiKeysQuery.isError

  return (
    <>
      <Button
        variant="secondary"
        size="medium"
        className="gap-1.5 px-3"
        disabled={buttonDisabled}
        onClick={() => setModalOpen(true)}
      >
        <span aria-hidden className="i-ri-key-2-line size-4" />
        {t(($) => $['apiKeyModal.apiSecretKey'], { ns: 'appApi' })}
        <span
          className={cn(
            'flex min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase tabular-nums',
            buttonDisabled ? 'text-text-disabled' : 'text-text-tertiary',
          )}
        >
          {apiKeyCount}
        </span>
      </Button>

      <SecretKeyModal
        appId={appId}
        canManage={canManage}
        isShow={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  )
}
