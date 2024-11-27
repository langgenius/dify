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

// eslint-disable-next-line react/display-name
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
      className={cn('relative col-span-1 inline-flex flex-col justify-between h-[160px] min-w-[296px] bg-gray-200 rounded-xl border-[0.5px] border-black/5', className)}
    >
      <div className='grow p-2 rounded-t-xl'>
        <div className='px-6 pt-2 pb-1 text-xs font-medium leading-[18px] text-gray-500'>{t('app.createApp')}</div>
        <div className='flex items-center mb-1 px-6 py-[7px] rounded-lg text-[13px] font-medium leading-[18px] text-gray-600 cursor-pointer hover:text-primary-600 hover:bg-white' onClick={() => setShowNewAppModal(true)}>
          <FilePlus01 className='shrink-0 mr-2 w-4 h-4' />
          {t('app.newApp.startFromBlank')}
        </div>
        <div className='flex items-center px-6 py-[7px] rounded-lg text-[13px] font-medium leading-[18px] text-gray-600 cursor-pointer hover:text-primary-600 hover:bg-white' onClick={() => setShowNewAppTemplateDialog(true)}>
          <FilePlus02 className='shrink-0 mr-2 w-4 h-4' />
          {t('app.newApp.startFromTemplate')}
        </div>
      </div>
      <div
        className='p-2 border-t-[0.5px] border-black/5 rounded-b-xl'
        onClick={() => setShowCreateFromDSLModal(true)}
      >
        <div className='flex items-center px-6 py-[7px] rounded-lg text-[13px] font-medium leading-[18px] text-gray-600 cursor-pointer hover:text-primary-600 hover:bg-white'>
          <FileArrow01 className='shrink-0 mr-2 w-4 h-4' />
          {t('app.importDSL')}
        </div>
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

export default CreateAppCard
