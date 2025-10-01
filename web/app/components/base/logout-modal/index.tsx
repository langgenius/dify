'use client'
import { useTranslation } from 'react-i18next'
import Confirm from '@/app/components/base/confirm'

type LogoutModalProps = {
  isShow: boolean
  source?: string
  onConfirm: () => void
  onCancel: () => void
}

const LogoutModal = ({ isShow, source, onConfirm, onCancel }: LogoutModalProps) => {
  const { t } = useTranslation()

  return (
    <Confirm
      type='warning'
      title={t('common.logout.confirmTitle')}
      content={t('common.logout.confirmMessage')}
      isShow={isShow}
      onConfirm={onConfirm}
      onCancel={onCancel}
      confirmText={t('common.logout.confirmButton')}
    />
  )
}

export default LogoutModal
