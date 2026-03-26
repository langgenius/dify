import type { InvitationResult } from '@/models/common'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { IS_CE_EDITION } from '@/config'
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open)
          onCancel()
      }}
    >
      <DialogContent
        backdropProps={{ forceRender: true }}
        className="w-[480px] p-8"
      >
        <DialogCloseButton className="right-8 top-8" />
        <div className="mb-3 flex justify-between">
          <div className="
            flex h-12 w-12 items-center justify-center rounded-xl
            border-[0.5px] border-components-panel-border bg-background-section-burn
            shadow-xl
          "
          >
            <div className="i-heroicons-check-circle-solid h-[22px] w-[22px] text-[#039855]" />
          </div>
        </div>
        <DialogTitle className="mb-1 text-xl font-semibold text-text-primary">{t('members.invitationSent', { ns: 'common' })}</DialogTitle>
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
                    <div className="py-2 text-sm font-medium text-text-primary">{t('members.invitationLink', { ns: 'common' })}</div>
                    {successInvitationResults.map(item =>
                      <InvitationLink key={item.email} value={item} />)}
                  </>
                )
              }
              {
                !!failedInvitationResults.length
                && (
                  <>
                    <div className="py-2 text-sm font-medium text-text-primary">{t('members.failedInvitationEmails', { ns: 'common' })}</div>
                    <div className="flex flex-wrap justify-between gap-y-1">
                      {
                        failedInvitationResults.map(item => (
                          <div key={item.email} className="flex justify-center rounded-md border border-red-300 bg-orange-50 px-1">
                            <Tooltip>
                              <TooltipTrigger
                                render={(
                                  <div className="flex items-center justify-center gap-1 text-sm">
                                    {item.email}
                                    <div className="i-ri-question-line h-4 w-4 text-red-300" />
                                  </div>
                                )}
                              />
                              <TooltipContent>
                                {item.message}
                              </TooltipContent>
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
      </DialogContent>
    </Dialog>
  )
}

export default InvitedModal
