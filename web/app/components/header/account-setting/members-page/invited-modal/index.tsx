import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import InvitationLink from './invitation-link'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
type IInvitedModalProps = {
  invitationLink: string
  onCancel: () => void
}
const InvitedModal = ({
  invitationLink,
  onCancel,
}: IInvitedModalProps) => {
  const { t } = useTranslation()

  return (
    <div className={s.wrap}>
      <Modal isShow onClose={() => {}} className={s.modal}>
        <div className='flex justify-between mb-3'>
          <div className='
            w-12 h-12 flex items-center justify-center rounded-xl
            bg-white border-[0.5px] border-gray-100
            shadow-[0px_20px_24px_-4px_rgba(16,24,40,0.08),0px_8px_8px_-4px_rgba(16,24,40,0.03)]
          '>
            <CheckCircleIcon className='w-[22px] h-[22px] text-[#039855]' />
          </div>
          <XMarkIcon className='w-4 h-4 cursor-pointer' onClick={onCancel} />
        </div>
        <div className='mb-1 text-xl font-semibold text-gray-900'>{t('common.members.invitationSent')}</div>
        <div className='mb-5 text-sm text-gray-500'>{t('common.members.invitationSentTip')}</div>
        <div className='mb-9'>
          <div className='py-2 text-sm font-Medium text-gray-900'>{t('common.members.invitationLink')}</div>
          <InvitationLink value={invitationLink} />
        </div>
        <div className='flex justify-end'>
          <Button
            className='w-[96px] text-sm font-medium'
            onClick={onCancel}
            type='primary'
          >
            {t('common.members.ok')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default InvitedModal
