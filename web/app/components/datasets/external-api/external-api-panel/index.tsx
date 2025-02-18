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

type ExternalAPIPanelProps = {
  onClose: () => void
}

const ExternalAPIPanel: React.FC<ExternalAPIPanelProps> = ({ onClose }) => {
  const { t } = useTranslation()
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
          'bg-components-panel-bg-alt border-components-panel-border relative flex h-full w-[420px] flex-col rounded-l-2xl border',
        )}
      >
        <div className='flex items-start self-stretch p-4 pb-0'>
          <div className='flex grow flex-col items-start gap-1'>
            <div className='text-text-primary system-xl-semibold self-stretch'>{t('dataset.externalAPIPanelTitle')}</div>
            <div className='text-text-tertiary body-xs-regular self-stretch'>{t('dataset.externalAPIPanelDescription')}</div>
            <a className='flex cursor-pointer items-center justify-center gap-1 self-stretch' href='https://docs.dify.ai/guides/knowledge-base/external-knowledge-api-documentation' target='_blank'>
              <RiBookOpenLine className='text-text-accent h-3 w-3' />
              <div className='text-text-accent body-xs-regular grow'>{t('dataset.externalAPIPanelDocumentation')}</div>
            </a>
          </div>
          <div className='flex items-center'>
            <ActionButton onClick={() => onClose()}>
              <RiCloseLine className='text-text-tertiary h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        <div className='flex flex-col items-start justify-center gap-2 self-stretch px-4 py-3'>
          <Button
            variant={'primary'}
            className='flex items-center justify-center gap-0.5 px-3 py-2'
            onClick={handleOpenExternalAPIModal}
          >
            <RiAddLine className='text-components-button-primary-text h-4 w-4' />
            <div className='text-components-button-primary-text system-sm-medium'>{t('dataset.createExternalAPI')}</div>
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
