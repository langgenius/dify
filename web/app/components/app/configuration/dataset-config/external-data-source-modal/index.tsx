import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'

type ExternalDataSourceModalProps = {
  onCancel: () => {}
}
const ExternalDataSourceModal: FC<ExternalDataSourceModalProps> = ({
  onCancel,
}) => {
  const { t } = useTranslation()

  return (
    <Modal
      isShow
      onClose={() => {}}
      className='!p-8 !pb-6 !max-w-none !w-[640px]'
    >
      <div>{t('appDebug.feature.dataSet.modal.title')}</div>
      <div>
        <div>{t('appDebug.feature.dataSet.modal.name.title')}</div>
        <input placeholder={t('appDebug.feature.dataSet.modal.name.placeholder') || ''} />
      </div>
      <div>
        <div>{t('appDebug.feature.dataSet.modal.description.title')}</div>
        <textarea placeholder={t('appDebug.feature.dataSet.modal.description.placeholder') || ''} />
      </div>
      <div>
        <div></div>
        <input />
      </div>
      <div>
        <input />
      </div>
    </Modal>
  )
}

export default ExternalDataSourceModal
