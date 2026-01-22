'use client'

import dynamic from 'next/dynamic'
import {
  useRouter,
  useSearchParams,
} from 'next/navigation'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContextSelector } from 'use-context-selector'
import { CreateFromDSLModalTab } from '@/app/components/app/create-from-dsl-modal'
import { FileArrow01, FilePlus01, FilePlus02 } from '@/app/components/base/icons/src/vender/line/files'
import AppListContext from '@/context/app-list-context'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'

const CreateAppModal = dynamic(() => import('@/app/components/app/create-app-modal'), {
  ssr: false,
})
const CreateAppTemplateDialog = dynamic(() => import('@/app/components/app/create-app-dialog'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

export type CreateAppCardProps = {
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
        'relative col-span-1 inline-flex h-[160px] flex-col justify-between rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg transition-opacity',
        isLoading && 'pointer-events-none opacity-50',
        className,
      )}
    >
      <div className="grow rounded-t-xl p-2">
        <div className="px-6 pb-1 pt-2 text-xs font-medium leading-[18px] text-text-tertiary">{t('createApp', { ns: 'app' })}</div>
        <button type="button" className="mb-1 flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary" onClick={() => setShowNewAppModal(true)}>
          <FilePlus01 className="mr-2 h-4 w-4 shrink-0" />
          {t('newApp.startFromBlank', { ns: 'app' })}
        </button>
        <button type="button" className="flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary" onClick={() => setShowNewAppTemplateDialog(true)}>
          <FilePlus02 className="mr-2 h-4 w-4 shrink-0" />
          {t('newApp.startFromTemplate', { ns: 'app' })}
        </button>
        <button
          type="button"
          onClick={() => setShowCreateFromDSLModal(true)}
          className="flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary"
        >
          <FileArrow01 className="mr-2 h-4 w-4 shrink-0" />
          {t('importDSL', { ns: 'app' })}
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
              replace('/')
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
