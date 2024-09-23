import React from 'react'
import {
  RiAddLine,
  RiBookOpenLine,
  RiCloseLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
// import AddExternalAPIForm from '../create/add-external-api'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import { useModalContext } from '@/context/modal-context'

type ExternalAPIPanelProps = {
  onClose: () => void
  isShow: boolean
}

const ExternalAPIPanel: React.FC<ExternalAPIPanelProps> = ({ onClose, isShow }) => {
  const { t } = useTranslation()
  const { setShowExternalAPIModal } = useModalContext()

  const handleOpenExternalAPIModal = () => {
    setShowExternalAPIModal()
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
            <a className='flex justify-center items-center gap-1 self-stretch cursor-pointer' href='https://docs.dify.ai/docs/external-api' target='_blank'>
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

        </div>
      </div>
    </div>
  )
}

export default ExternalAPIPanel
