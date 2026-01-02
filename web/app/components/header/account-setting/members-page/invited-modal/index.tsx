import type { InvitationResult } from '@/models/common'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import { RiQuestionLine } from '@remixicon/react'
import { noop } from 'es-toolkit/function'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Tooltip from '@/app/components/base/tooltip'
import { IS_CE_EDITION } from '@/config'
import s from './index.module.css'
import InvitationLink from './invitation-link'

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
      <Modal isShow onClose={noop} className={s.modal}>
        <div className="mb-3 flex justify-between">
          <div className="
            flex h-12 w-12 items-center justify-center rounded-xl
            border-[0.5px] border-components-panel-border bg-background-section-burn
            shadow-xl
          "
          >
            <CheckCircleIcon className="h-[22px] w-[22px] text-[#039855]" />
          </div>
          <XMarkIcon className="h-4 w-4 cursor-pointer" onClick={onCancel} />
        </div>
        <div className="mb-1 text-xl font-semibold text-text-primary">{t('members.invitationSent', { ns: 'common' })}</div>
        {!IS_CE_EDITION && (
          <div className="mb-10 text-sm text-text-tertiary">{t('members.invitationSentTip', { ns: 'common' })}</div>
        )}
        {IS_CE_EDITION && (
          <>
            <div className="mb-5 text-sm text-text-tertiary">{t('members.invitationSentTip', { ns: 'common' })}</div>
            <div className="mb-9 flex flex-col gap-2">
              {
                !!successInvitationResults.length
                && (
                  <>
                    <div className="font-Medium py-2 text-sm text-text-primary">{t('members.invitationLink', { ns: 'common' })}</div>
                    {successInvitationResults.map(item =>
                      <InvitationLink key={item.email} value={item} />)}
                  </>
                )
              }
              {
                !!failedInvitationResults.length
                && (
                  <>
                    <div className="font-Medium py-2 text-sm text-text-primary">{t('members.failedInvitationEmails', { ns: 'common' })}</div>
                    <div className="flex flex-wrap justify-between gap-y-1">
                      {
                        failedInvitationResults.map(item => (
                          <div key={item.email} className="flex justify-center rounded-md border border-red-300 bg-orange-50 px-1">
                            <Tooltip
                              popupContent={item.message}
                            >
                              <div className="flex items-center justify-center gap-1 text-sm">
                                {item.email}
                                <RiQuestionLine className="h-4 w-4 text-red-300" />
                              </div>
                            </Tooltip>
                          </div>
                        ),
                        )
                      }
                    </div>
                  </>
                )
              }
            </div>
          </>
        )}
        <div className="flex justify-end">
          <Button
            className="w-[96px]"
            onClick={onCancel}
            variant="primary"
          >
            {t('members.ok', { ns: 'common' })}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default InvitedModal
