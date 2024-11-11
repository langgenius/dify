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
      className={cn('absolute top-14 right-0 bottom-2 flex z-10 outline-none')}
    >
      <div
        className={cn(
          'relative flex flex-col w-[420px] bg-components-panel-bg-alt rounded-l-2xl h-full border border-components-panel-border',
        )}
      >
        <div className='flex items-start self-stretch p-4 pb-0'>
          <div className='flex flex-col items-start gap-1 flex-grow'>
            <div className='self-stretch text-text-primary system-xl-semibold'>{t('dataset.externalAPIPanelTitle')}</div>
            <div className='self-stretch text-text-tertiary body-xs-regular'>{t('dataset.externalAPIPanelDescription')}</div>
            <a className='flex justify-center items-center gap-1 self-stretch cursor-pointer' href='https://docs.dify.ai/guides/knowledge-base/external-knowledge-api-documentation' target='_blank'>
              <RiBookOpenLine className='w-3 h-3 text-text-accent' />
              <div className='flex-grow text-text-accent body-xs-regular'>{t('dataset.externalAPIPanelDocumentation')}</div>
            </a>
          </div>
          <div className='flex items-center'>
            <ActionButton onClick={() => onClose()}>
              <RiCloseLine className='w-4 h-4 text-text-tertiary' />
            </ActionButton>
          </div>
        </div>
        <div className='flex px-4 py-3 flex-col justify-center items-start gap-2 self-stretch'>
          <Button
            variant={'primary'}
            className='flex justify-center items-center px-3 py-2 gap-0.5'
            onClick={handleOpenExternalAPIModal}
          >
            <RiAddLine className='w-4 h-4 text-components-button-primary-text' />
            <div className='text-components-button-primary-text system-sm-medium'>{t('dataset.createExternalAPI')}</div>
          </Button>
        </div>
        <div className='flex py-0 px-4 flex-col items-start gap-1 flex-grow self-stretch'>
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
