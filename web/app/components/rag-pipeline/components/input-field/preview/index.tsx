import { RiCloseLine } from '@remixicon/react'
import DialogWrapper from './dialog-wrapper'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'

type PreviewPanelProps = {
  show: boolean
  onClose: () => void
}

const PreviewPanel = ({
  show,
  onClose,
}: PreviewPanelProps) => {
  const { t } = useTranslation()

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
      panelWrapperClassName='pr-[424px]'
    >
      <div className='flex items-center gap-x-2 px-4 pt-1'>
        <div className='grow py-1'>
          <Badge className='border-text-accent-secondary bg-components-badge-bg-dimm text-text-accent-secondary'>
            {t('datasetPipeline.operations.preview')}
          </Badge>
        </div>
        <button
          type='button'
          className='flex size-6 shrink-0 items-center justify-center'
          onClick={onClose}
        >
          <RiCloseLine className='size-4 text-text-tertiary' />
        </button>
      </div>
    </DialogWrapper>
  )
}

export default PreviewPanel
