'use client'

import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import { CreateFromDSLModalTab } from '@/app/components/app/create-from-dsl-modal'
import AppListContext from '@/context/app-list-context'
import { useProviderContext } from '@/context/provider-context'
import dynamic from '@/next/dynamic'
import {
  useRouter,
  useSearchParams,
} from '@/next/navigation'

const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), {
  ssr: false,
})
const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

const actionButtonClassName = 'group flex w-full cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-left system-sm-medium text-text-tertiary outline-hidden transition-colors hover:bg-background-default-dodge hover:text-text-secondary hover:shadow-xs hover:shadow-shadow-shadow-3 focus-visible:bg-background-default-dodge focus-visible:text-text-secondary focus-visible:shadow-xs focus-visible:shadow-shadow-shadow-3'
const actionIconClassName = 'size-4 shrink-0 text-text-tertiary group-hover:text-text-secondary group-focus-visible:text-text-secondary'

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

  const controlHideCreateFromTemplatePanel = useContextSelector(AppListContext, ctx => ctx.controlHideCreateFromTemplatePanel)
  useEffect(() => {
    if (controlHideCreateFromTemplatePanel > 0)
      // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect
      setShowNewAppTemplateDialog(false)
  }, [controlHideCreateFromTemplatePanel])

  return (
    <div
      ref={ref}
      className={cn(
        'relative col-span-1 inline-flex h-41.5 flex-col overflow-hidden rounded-xl bg-background-default-dimmed transition-opacity',
        isLoading && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <div className="flex min-h-0 grow flex-col justify-center p-2">
        <div className="flex w-full flex-col gap-0.5">
          <button type="button" className={actionButtonClassName} onClick={() => setShowNewAppModal(true)}>
            <span aria-hidden="true" className={cn('i-ri-sticky-note-add-line', actionIconClassName)} />
            <span className="min-w-0 grow truncate">{t('newApp.startFromBlank', { ns: 'app' })}</span>
          </button>
          <button type="button" className={actionButtonClassName} onClick={() => setShowNewAppTemplateDialog(true)}>
            <span aria-hidden="true" className={cn('i-ri-function-add-line', actionIconClassName)} />
            <span className="min-w-0 grow truncate">{t('newApp.startFromTemplate', { ns: 'app' })}</span>
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center border-t-[0.5px] border-divider-subtle p-2">
        <button
          type="button"
          onClick={() => setShowCreateFromDSLModal(true)}
          className={actionButtonClassName}
        >
          <span aria-hidden="true" className={cn('i-ri-file-upload-line', actionIconClassName)} />
          <span className="min-w-0 grow truncate">{t('importDSL', { ns: 'app' })}</span>
        </button>
      </div>

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
          defaultAppMode={selectedAppType !== 'all' ? selectedAppType as any : undefined}
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
    </div>
  )
}

CreateAppCard.displayName = 'CreateAppCard'

export default React.memo(CreateAppCard)
