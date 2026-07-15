import type {
  MemberInviteAlreadyMemberResponse,
  MemberInviteFailedResponse,
  MemberInviteResponse,
  MemberInviteSuccessResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { IS_CE_EDITION } from '@/config'
import InvitationLink from './invitation-link'

type IInvitedModalProps = {
  invitationResults: MemberInviteResponse['invitation_results']
  onCancel: () => void
}
const InvitedModal = ({ invitationResults, onCancel }: IInvitedModalProps) => {
  const { t } = useTranslation()

  const successInvitationResults = invitationResults.filter(
    (item): item is MemberInviteSuccessResponse => item.status === 'success',
  )
  const alreadyMemberInvitationResults = invitationResults.filter(
    (item): item is MemberInviteAlreadyMemberResponse => item.status === 'already_member',
  )
  const failedInvitationResults = invitationResults.filter(
    (item): item is MemberInviteFailedResponse => item.status === 'failed',
  )
  const onlyAlreadyMembers =
    alreadyMemberInvitationResults.length > 0 &&
    successInvitationResults.length === 0 &&
    failedInvitationResults.length === 0
  const description = t(
    ($) => $[onlyAlreadyMembers ? 'members.alreadyInTeamTip' : 'members.invitationSentTip'],
    { ns: 'common' },
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent backdropProps={{ forceRender: true }} className="w-[480px] p-8">
        <DialogCloseButton className="top-8 right-8" />
        <div className="mb-3 flex justify-between">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border-[0.5px] border-components-panel-border bg-background-section-burn shadow-xl">
            <div className="i-heroicons-check-circle-solid h-[22px] w-[22px] text-[#039855]" />
          </div>
        </div>
        <DialogTitle className="mb-1 text-xl font-semibold text-text-primary">
          {t(
            ($) =>
              $[onlyAlreadyMembers ? 'members.noNewInvitationsSent' : 'members.invitationSent'],
            { ns: 'common' },
          )}
        </DialogTitle>
        {!IS_CE_EDITION && <div className="mb-5 text-sm text-text-tertiary">{description}</div>}
        {(IS_CE_EDITION || !!alreadyMemberInvitationResults.length) && (
          <>
            {IS_CE_EDITION && <div className="mb-5 text-sm text-text-tertiary">{description}</div>}
            <div className="mb-9 flex flex-col gap-2">
              {IS_CE_EDITION && !!successInvitationResults.length && (
                <>
                  <div className="py-2 text-sm font-medium text-text-primary">
                    {t(($) => $['members.invitationLink'], { ns: 'common' })}
                  </div>
                  {successInvitationResults.map((item) => (
                    <InvitationLink key={item.email} value={item} />
                  ))}
                </>
              )}
              {!!alreadyMemberInvitationResults.length && (
                <>
                  <div className="py-2 text-sm font-medium text-text-primary">
                    {t(($) => $['members.alreadyInTeam'], { ns: 'common' })}
                  </div>
                  {!onlyAlreadyMembers && (
                    <div className="text-sm text-text-tertiary">
                      {t(($) => $['members.alreadyInTeamTip'], { ns: 'common' })}
                    </div>
                  )}
                  <div className="flex flex-wrap justify-between gap-y-1">
                    {alreadyMemberInvitationResults.map((item) => (
                      <div
                        key={item.email}
                        className="flex justify-center rounded-md border border-components-panel-border bg-background-section-burn px-1 text-sm text-text-secondary"
                      >
                        {item.email}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {IS_CE_EDITION && !!failedInvitationResults.length && (
                <>
                  <div className="py-2 text-sm font-medium text-text-primary">
                    {t(($) => $['members.failedInvitationEmails'], { ns: 'common' })}
                  </div>
                  <div className="flex flex-wrap justify-between gap-y-1">
                    {failedInvitationResults.map((item) => (
                      <div
                        key={item.email}
                        className="flex justify-center rounded-md border border-red-300 bg-orange-50 px-1"
                      >
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <div className="flex items-center justify-center gap-1 text-sm">
                                {item.email}
                                <div className="i-ri-question-line size-4 text-red-300" />
                              </div>
                            }
                          />
                          <TooltipContent>{item.message}</TooltipContent>
                        </Tooltip>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
        <div className="flex justify-end">
          <Button className="w-[96px]" onClick={onCancel} variant="primary">
            {t(($) => $['members.ok'], { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default InvitedModal
