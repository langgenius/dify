import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import DialogWrapper from '@/app/components/base/features/new-feature-panel/dialog-wrapper'

type Props = {
  show: boolean
  disabled: boolean
  onChange: () => void
  onClose: () => void
}

const NewFeaturePanel = ({ show, onClose }: Props) => {
  const { t } = useTranslation()

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
    >
      <div className='grow flex flex-col h-full'>
        <div className='shrink-0 flex justify-between p-4 pb-3'>
          <div>
            <div className='text-text-primary system-xl-semibold'>{t('workflow.common.features')}</div>
            <div className='text-text-tertiary body-xs-regular'>{t('workflow.common.featuresDescription')}</div>
          </div>
          <div className='w-8 h-8 p-2 cursor-pointer' onClick={onClose}><RiCloseLine className='w-4 h-4 text-text-tertiary'/></div>
        </div>
        <div className='grow overflow-y-auto pb-4'>
        </div>
      </div>
    </DialogWrapper>
  )
}

export default NewFeaturePanel
