import type {
  MemberInviteAlreadyMemberResponse,
  MemberInviteFailedResponse,
  MemberInviteResponse,
  MemberInviteSuccessResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import InvitationLink from './invitation-link'

type IInvitedModalProps = {
  invitationResults: MemberInviteResponse['invitation_results']
  onCancel: () => void
}
const InvitedModal = ({ invitationResults, onCancel }: IInvitedModalProps) => {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const isCloudEdition = deploymentEdition === 'CLOUD'
  const isNonCloudEdition = deploymentEdition === 'COMMUNITY' || deploymentEdition === 'ENTERPRISE'

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
    { ns: 'workspaceMembers' },
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent backdropProps={{ forceRender: true }}>
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl border-[0.5px] border-components-panel-border bg-background-section-burn shadow-xl">
            <div className="i-heroicons-check-circle-solid h-5.5 w-5.5 text-[#039855]" />
          </div>
          <DialogTitle>
            {t(
              ($) =>
                $[onlyAlreadyMembers ? 'members.noNewInvitationsSent' : 'members.invitationSent'],
              { ns: 'workspaceMembers' },
            )}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="space-y-5">
          {isCloudEdition && <div className="text-sm text-text-tertiary">{description}</div>}
          {(isNonCloudEdition || !!alreadyMemberInvitationResults.length) && (
            <>
              {isNonCloudEdition && <div className="text-sm text-text-tertiary">{description}</div>}
              <div className="flex flex-col gap-2">
                {isNonCloudEdition && !!successInvitationResults.length && (
                  <>
                    <div className="py-2 text-sm font-medium text-text-primary">
                      {t(($) => $['members.invitationLink'], { ns: 'workspaceMembers' })}
                    </div>
                    {successInvitationResults.map((item) => (
                      <InvitationLink key={item.email} value={item} />
                    ))}
                  </>
                )}
                {!!alreadyMemberInvitationResults.length && (
                  <>
                    <div className="py-2 text-sm font-medium text-text-primary">
                      {t(($) => $['members.alreadyInTeam'], { ns: 'workspaceMembers' })}
                    </div>
                    {!onlyAlreadyMembers && (
                      <div className="text-sm text-text-tertiary">
                        {t(($) => $['members.alreadyInTeamTip'], { ns: 'workspaceMembers' })}
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
                {isNonCloudEdition && !!failedInvitationResults.length && (
                  <>
                    <div className="py-2 text-sm font-medium text-text-primary">
                      {t(($) => $['members.failedInvitationEmails'], { ns: 'workspaceMembers' })}
                    </div>
                    <ul className="flex flex-col gap-2">
                      {failedInvitationResults.map((item) => (
                        <li
                          key={item.email}
                          className="flex min-w-0 flex-col rounded-md border border-red-300 bg-orange-50 px-2 py-1 text-sm"
                        >
                          <span className="wrap-anywhere">{item.email}</span>
                          <span className="wrap-anywhere">{item.message}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button className="w-24" onClick={onCancel} variant="primary">
            {t(($) => $['members.ok'], { ns: 'workspaceMembers' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default InvitedModal
