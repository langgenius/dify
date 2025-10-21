import React from 'react'
import {
  RiAddLine,
  RiBookOpenLine,
  RiCloseLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import ExternalKnowledgeAPICard from '../external-knowledge-api-card'
import cn from '@/utils/classnames'
import { useExternalKnowledgeApi } from '@/context/external-knowledge-api-context'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import { useModalContext } from '@/context/modal-context'
import { useDocLink } from '@/context/i18n'

type ExternalAPIPanelProps = {
  onClose: () => void
}

const ExternalAPIPanel: React.FC<ExternalAPIPanelProps> = ({ onClose }) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { setShowExternalKnowledgeAPIModal } = useModalContext()
  const { externalKnowledgeApiList, mutateExternalKnowledgeApis, isLoading } = useExternalKnowledgeApi()

  const handleOpenExternalAPIModal = () => {
    setShowExternalKnowledgeAPIModal({
      payload: { name: '', settings: { endpoint: '', api_key: '' } },
      datasetBindings: [],
      onSaveCallback: () => {
        mutateExternalKnowledgeApis()
      },
      onCancelCallback: () => {
        mutateExternalKnowledgeApis()
      },
      isEditMode: false,
    })
  }

  return (
    <div
      tabIndex={-1}
      className={cn('absolute bottom-2 right-0 top-14 z-10 flex outline-none')}
    >
      <div
        className={cn(
          'relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt',
        )}
      >
        <div className='flex items-start self-stretch p-4 pb-0'>
          <div className='flex grow flex-col items-start gap-1'>
            <div className='system-xl-semibold self-stretch text-text-primary'>{t('dataset.externalAPIPanelTitle')}</div>
            <div className='body-xs-regular self-stretch text-text-tertiary'>{t('dataset.externalAPIPanelDescription')}</div>
            <a className='flex cursor-pointer items-center justify-center gap-1 self-stretch'
              href={docLink('/guides/knowledge-base/connect-external-knowledge-base')} target='_blank'>
              <RiBookOpenLine className='h-3 w-3 text-text-accent' />
              <div className='body-xs-regular grow text-text-accent'>{t('dataset.externalAPIPanelDocumentation')}</div>
            </a>
          </div>
          <div className='flex items-center'>
            <ActionButton onClick={() => onClose()}>
              <RiCloseLine className='h-4 w-4 text-text-tertiary' />
            </ActionButton>
          </div>
        </div>
        <div className='flex flex-col items-start justify-center gap-2 self-stretch px-4 py-3'>
          <Button
            variant={'primary'}
            className='flex items-center justify-center gap-0.5 px-3 py-2'
            onClick={handleOpenExternalAPIModal}
          >
            <RiAddLine className='h-4 w-4 text-components-button-primary-text' />
            <div className='system-sm-medium text-components-button-primary-text'>{t('dataset.createExternalAPI')}</div>
          </Button>
        </div>
        <div className='flex grow flex-col items-start gap-1 self-stretch px-4 py-0'>
          {isLoading
            ? (
              <Loading />
            )
            : (
              externalKnowledgeApiList.map(api => (
                <ExternalKnowledgeAPICard key={api.id} api={api} />
              ))
            )}
        </div>
      </div>
    </div>
  )
}

export default ExternalAPIPanel
