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
        <div className='flex justify-between mb-3'>
          <div className='
            w-12 h-12 flex items-center justify-center rounded-xl
            bg-background-section-burn border-[0.5px] border-components-panel-border
            shadow-xl
          '>
            <CheckCircleIcon className='w-[22px] h-[22px] text-[#039855]' />
          </div>
          <XMarkIcon className='w-4 h-4 cursor-pointer' onClick={onCancel} />
        </div>
        <div className='mb-1 text-xl font-semibold text-text-primary'>{t('common.members.invitationSent')}</div>
        {!IS_CE_EDITION && (
          <div className='mb-10 text-sm text-text-tertiary'>{t('common.members.invitationSentTip')}</div>
        )}
        {IS_CE_EDITION && (
          <>
            <div className='mb-5 text-sm text-text-tertiary'>{t('common.members.invitationSentTip')}</div>
            <div className='flex flex-col gap-2 mb-9'>
              {
                !!successInvitationResults.length
                && <>
                  <div className='py-2 text-sm font-Medium text-text-primary'>{t('common.members.invitationLink')}</div>
                  {successInvitationResults.map(item =>
                    <InvitationLink key={item.email} value={item} />)}
                </>
              }
              {
                !!failedInvitationResults.length
                && <>
                  <div className='py-2 text-sm font-Medium text-text-primary'>{t('common.members.failedInvitationEmails')}</div>
                  <div className='flex flex-wrap justify-between gap-y-1'>
                    {
                      failedInvitationResults.map(item =>
                        <div key={item.email} className='flex justify-center border border-red-300 rounded-md px-1 bg-orange-50'>
                          <Tooltip
                            popupContent={item.message}
                          >
                            <div className='flex justify-center items-center text-sm gap-1'>
                              {item.email}
                              <RiQuestionLine className='w-4 h-4 text-red-300' />
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
