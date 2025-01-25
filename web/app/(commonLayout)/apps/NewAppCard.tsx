'use client'

import { forwardRef, useMemo, useState } from 'react'
import {
  useRouter,
  useSearchParams,
} from 'next/navigation'
import { useTranslation } from 'react-i18next'
import CreateAppTemplateDialog from '@/app/components/app/create-app-dialog'
import CreateAppModal from '@/app/components/app/create-app-modal'
import CreateFromDSLModal, { CreateFromDSLModalTab } from '@/app/components/app/create-from-dsl-modal'
import { useProviderContext } from '@/context/provider-context'
import { FileArrow01, FilePlus01, FilePlus02 } from '@/app/components/base/icons/src/vender/line/files'
import cn from '@/utils/classnames'

export type CreateAppCardProps = {
  className?: string
  onSuccess?: () => void
}

const CreateAppCard = forwardRef<HTMLDivElement, CreateAppCardProps>(({ className, onSuccess }, ref) => {
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

  return (
    <div
      ref={ref}
      className={cn('relative col-span-1 inline-flex flex-col justify-between h-[160px] bg-components-card-bg rounded-xl border-[0.5px] border-components-card-border', className)}
    >
      <div className='grow p-2 rounded-t-xl'>
        <div className='px-6 pt-2 pb-1 text-xs font-medium leading-[18px] text-text-tertiary'>{t('app.createApp')}</div>
        <button className='w-full flex items-center mb-1 px-6 py-[7px] rounded-lg text-[13px] font-medium leading-[18px] text-text-tertiary cursor-pointer hover:text-text-secondary hover:bg-state-base-hover' onClick={() => setShowNewAppModal(true)}>
          <FilePlus01 className='shrink-0 mr-2 w-4 h-4' />
          {t('app.newApp.startFromBlank')}
        </button>
        <button className='w-full flex items-center px-6 py-[7px] rounded-lg text-[13px] font-medium leading-[18px] text-text-tertiary cursor-pointer hover:text-text-secondary hover:bg-state-base-hover' onClick={() => setShowNewAppTemplateDialog(true)}>
          <FilePlus02 className='shrink-0 mr-2 w-4 h-4' />
          {t('app.newApp.startFromTemplate')}
        </button>
        <button
          onClick={() => setShowCreateFromDSLModal(true)}
          className='w-full flex items-center px-6 py-[7px] rounded-lg text-[13px] font-medium leading-[18px] text-text-tertiary cursor-pointer hover:text-text-secondary hover:bg-state-base-hover'>
          <FileArrow01 className='shrink-0 mr-2 w-4 h-4' />
          {t('app.importDSL')}
        </button>
      </div>

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
      />
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
    </div>
  )
})

CreateAppCard.displayName = 'CreateAppCard'
export default CreateAppCard
export { CreateAppCard }
