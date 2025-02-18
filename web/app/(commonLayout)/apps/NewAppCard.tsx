'use client'

import { useMemo, useState } from 'react'
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

const CreateAppCard = (
  {
    ref,
    className,
    onSuccess,
  }: CreateAppCardProps & {
    ref?: React.RefObject<HTMLDivElement>;
  },
) => {
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
      className={cn('bg-components-card-bg border-components-card-border relative col-span-1 inline-flex h-[160px] flex-col justify-between rounded-xl border-[0.5px]', className)}
    >
      <div className='grow rounded-t-xl p-2'>
        <div className='text-text-tertiary px-6 pb-1 pt-2 text-xs font-medium leading-[18px]'>{t('app.createApp')}</div>
        <button className='text-text-tertiary hover:text-text-secondary hover:bg-state-base-hover mb-1 flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px]' onClick={() => setShowNewAppModal(true)}>
          <FilePlus01 className='mr-2 h-4 w-4 shrink-0' />
          {t('app.newApp.startFromBlank')}
        </button>
        <button className='text-text-tertiary hover:text-text-secondary hover:bg-state-base-hover flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px]' onClick={() => setShowNewAppTemplateDialog(true)}>
          <FilePlus02 className='mr-2 h-4 w-4 shrink-0' />
          {t('app.newApp.startFromTemplate')}
        </button>
        <button
          onClick={() => setShowCreateFromDSLModal(true)}
          className='text-text-tertiary hover:text-text-secondary hover:bg-state-base-hover flex w-full cursor-pointer items-center rounded-lg px-6 py-[7px] text-[13px] font-medium leading-[18px]'>
          <FileArrow01 className='mr-2 h-4 w-4 shrink-0' />
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
}

CreateAppCard.displayName = 'CreateAppCard'
export default CreateAppCard
export { CreateAppCard }
