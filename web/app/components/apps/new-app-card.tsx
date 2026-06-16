'use client'

import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import { CreateFromDSLModalTab } from '@/app/components/app/create-from-dsl-modal'
import CreateResourceCard, {
  createResourceCardActionClassName,
  createResourceCardActionIconClassName,
} from '@/app/components/base/create-resource-card'
import AppListContext from '@/context/app-list-context'
import { useProviderContext } from '@/context/provider-context'
import dynamic from '@/next/dynamic'
import {
  useRouter,
  useSearchParams,
} from '@/next/navigation'
import { AppModeEnum } from '@/types/app'

const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), {
  ssr: false,
})
const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

type CreateAppCardProps = {
  className?: string
  isLoading?: boolean
  onSuccess?: () => void
  ref: React.RefObject<HTMLDivElement | null>
  selectedAppType?: string
}

const CreateAppCard = ({
  ref,
  className,
  isLoading = false,
  onSuccess,
  selectedAppType,
}: CreateAppCardProps) => {
  const { t } = useTranslation()
  const { onPlanInfoChanged } = useProviderContext()
  const searchParams = useSearchParams()
  const { replace } = useRouter()
  const dslUrl = searchParams.get('remoteInstallUrl') || undefined

  const [showNewAppTemplateDialog, setShowNewAppTemplateDialog] = useState(false)
  const [showNewAppModal, setShowNewAppModal] = useState(false)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(!!dslUrl)

  const activeTab = useMemo(() => {
    if (dslUrl)
      return CreateFromDSLModalTab.FROM_URL

    return undefined
  }, [dslUrl])
  const defaultAppMode = useMemo(() => {
    if (!selectedAppType || selectedAppType === 'all')
      return undefined

    return Object.values(AppModeEnum).includes(selectedAppType as AppModeEnum)
      ? selectedAppType as AppModeEnum
      : undefined
  }, [selectedAppType])

  const controlHideCreateFromTemplatePanel = useContextSelector(AppListContext, ctx => ctx.controlHideCreateFromTemplatePanel)
  useEffect(() => {
    if (controlHideCreateFromTemplatePanel <= 0)
      return

    let cancelled = false
    queueMicrotask(() => {
      if (cancelled)
        return

      setShowNewAppTemplateDialog(false)
    })

    return () => {
      cancelled = true
    }
  }, [controlHideCreateFromTemplatePanel])

  return (
    <>
      <CreateResourceCard
        ref={ref}
        className={className}
        isLoading={isLoading}
        footer={(
          <button
            type="button"
            onClick={() => setShowCreateFromDSLModal(true)}
            className={createResourceCardActionClassName}
          >
            <span aria-hidden="true" className={`i-ri-file-upload-line ${createResourceCardActionIconClassName}`} />
            <span className="min-w-0 grow truncate">{t('importDSL', { ns: 'app' })}</span>
          </button>
        )}
      >
        <button type="button" className={createResourceCardActionClassName} onClick={() => setShowNewAppModal(true)}>
          <span aria-hidden="true" className={`i-ri-sticky-note-add-line ${createResourceCardActionIconClassName}`} />
          <span className="min-w-0 grow truncate">{t('newApp.startFromBlank', { ns: 'app' })}</span>
        </button>
        <button type="button" className={createResourceCardActionClassName} onClick={() => setShowNewAppTemplateDialog(true)}>
          <span aria-hidden="true" className={`i-ri-function-add-line ${createResourceCardActionIconClassName}`} />
          <span className="min-w-0 grow truncate">{t('newApp.startFromTemplate', { ns: 'app' })}</span>
        </button>
      </CreateResourceCard>
      {showNewAppModal && (
        <CreateAppModal
          show={showNewAppModal}
          onClose={() => setShowNewAppModal(false)}
          onSuccess={() => {
            onPlanInfoChanged()
            if (onSuccess)
              onSuccess()
          }}
          onCreateFromTemplate={() => {
            setShowNewAppTemplateDialog(true)
            setShowNewAppModal(false)
          }}
          defaultAppMode={defaultAppMode}
        />
      )}
      {showNewAppTemplateDialog && (
        <CreateAppTemplateDialog
          show={showNewAppTemplateDialog}
          onClose={() => setShowNewAppTemplateDialog(false)}
          onSuccess={() => {
            onPlanInfoChanged()
            if (onSuccess)
              onSuccess()
          }}
          onCreateFromBlank={() => {
            setShowNewAppModal(true)
            setShowNewAppTemplateDialog(false)
          }}
        />
      )}
      {showCreateFromDSLModal && (
        <CreateFromDSLModal
          show={showCreateFromDSLModal}
          onClose={() => {
            setShowCreateFromDSLModal(false)

            if (dslUrl)
              replace('/apps')
          }}
          activeTab={activeTab}
          dslUrl={dslUrl}
          onSuccess={() => {
            onPlanInfoChanged()
            if (onSuccess)
              onSuccess()
          }}
        />
      )}
    </>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default React.memo(CreateAppCard)
