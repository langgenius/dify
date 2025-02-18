import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { RiQuestionLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import InvitationLink from './invitation-link'
import s from './index.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { IS_CE_EDITION } from '@/config'
import type { InvitationResult } from '@/models/common'
import Tooltip from '@/app/components/base/tooltip'

export type SuccessInvitationResult = Extract<InvitationResult, { status: 'success' }>
export type FailedInvitationResult = Extract<InvitationResult, { status: 'failed' }>

type IInvitedModalProps = {
  invitationResults: InvitationResult[]
  onCancel: () => void
}
const InvitedModal = ({
  invitationResults,
  onCancel,
}: IInvitedModalProps) => {
  const { t } = useTranslation()

  const successInvitationResults = useMemo<SuccessInvitationResult[]>(() => invitationResults?.filter(item => item.status === 'success') as SuccessInvitationResult[], [invitationResults])
  const failedInvitationResults = useMemo<FailedInvitationResult[]>(() => invitationResults?.filter(item => item.status !== 'success') as FailedInvitationResult[], [invitationResults])

  return (
    <div className={s.wrap}>
      <Modal isShow onClose={() => {}} className={s.modal}>
        <div className='mb-3 flex justify-between'>
          <div className='
            flex h-12 w-12 items-center justify-center rounded-xl
            border-[0.5px] border-gray-100 bg-white
            shadow-xl
          '>
            <CheckCircleIcon className='h-[22px] w-[22px] text-[#039855]' />
          </div>
          <XMarkIcon className='h-4 w-4 cursor-pointer' onClick={onCancel} />
        </div>
        <div className='mb-1 text-xl font-semibold text-gray-900'>{t('common.members.invitationSent')}</div>
        {!IS_CE_EDITION && (
          <div className='mb-10 text-sm text-gray-500'>{t('common.members.invitationSentTip')}</div>
        )}
        {IS_CE_EDITION && (
          <>
            <div className='mb-5 text-sm text-gray-500'>{t('common.members.invitationSentTip')}</div>
            <div className='mb-9 flex flex-col gap-2'>
              {
                !!successInvitationResults.length
                && <>
                  <div className='font-Medium py-2 text-sm text-gray-900'>{t('common.members.invitationLink')}</div>
                  {successInvitationResults.map(item =>
                    <InvitationLink key={item.email} value={item} />)}
                </>
              }
              {
                !!failedInvitationResults.length
                && <>
                  <div className='font-Medium py-2 text-sm text-gray-900'>{t('common.members.failedInvitationEmails')}</div>
                  <div className='flex flex-wrap justify-between gap-y-1'>
                    {
                      failedInvitationResults.map(item =>
                        <div key={item.email} className='flex justify-center rounded-md border border-red-300 bg-orange-50 px-1'>
                          <Tooltip
                            popupContent={item.message}
                          >
                            <div className='flex items-center justify-center gap-1 text-sm'>
                              {item.email}
                              <RiQuestionLine className='h-4 w-4 text-red-300' />
                            </div>
                          </Tooltip>
                        </div>,
                      )
                    }
                  </div>
                </>
              }
            </div>
          </>
        )}
        <div className='flex justify-end'>
          <Button
            className='w-[96px]'
            onClick={onCancel}
            variant='primary'
          >
            {t('common.members.ok')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default InvitedModal
