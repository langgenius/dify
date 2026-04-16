'use client'
import type { RoleKey } from './role-selector'
import type { InvitationResult } from '@/models/common'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactMultiEmail } from 'react-multi-email'
import { Button } from '@/app/components/base/ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@/app/components/base/ui/dialog'
import { toast } from '@/app/components/base/ui/toast'
import { emailRegex } from '@/config'
import { useLocale } from '@/context/i18n'
import { useProviderContextSelector } from '@/context/provider-context'
import { inviteMember } from '@/service/common'
import RoleSelector from './role-selector'
import 'react-multi-email/dist/style.css'

type IInviteModalProps = {
  isEmailSetup: boolean
  onCancel: () => void
  onSend: (invitationResults: InvitationResult[]) => void
}

const InviteModal = ({
  isEmailSetup,
  onCancel,
  onSend,
}: IInviteModalProps) => {
  const { t } = useTranslation()
  const licenseLimit = useProviderContextSelector(s => s.licenseLimit)
  const refreshLicenseLimit = useProviderContextSelector(s => s.refreshLicenseLimit)
  const [emails, setEmails] = useState<string[]>([])
  const [isLimited, setIsLimited] = useState(false)
  const [isLimitExceeded, setIsLimitExceeded] = useState(false)
  const [usedSize, setUsedSize] = useState(licenseLimit.workspace_members.size ?? 0)
  useEffect(() => {
    const limited = licenseLimit.workspace_members.limit > 0
    const used = emails.length + licenseLimit.workspace_members.size
    setIsLimited(limited)
    setUsedSize(used)
    setIsLimitExceeded(limited && (used > licenseLimit.workspace_members.limit))
  }, [licenseLimit, emails])

  const locale = useLocale()
  const [role, setRole] = useState<RoleKey>('normal')

  const [isSubmitting, {
    setTrue: setIsSubmitting,
    setFalse: setIsSubmitted,
  }] = useBoolean(false)

  const handleSend = useCallback(async () => {
    if (isLimitExceeded || isSubmitting)
      return
    setIsSubmitting()
    if (emails.map((email: string) => emailRegex.test(email)).every(Boolean)) {
      try {
        const { result, invitation_results } = await inviteMember({
          url: '/workspaces/current/members/invite-email',
          body: { emails, role, language: locale },
        })

        if (result === 'success') {
          refreshLicenseLimit()
          onCancel()
          onSend(invitation_results)
        }
      }
      catch { }
    }
    else {
      toast.error(t('members.emailInvalid', { ns: 'common' }))
    }
    setIsSubmitted()
  }, [isLimitExceeded, emails, role, locale, onCancel, onSend, t, isSubmitting, refreshLicenseLimit, setIsSubmitted, setIsSubmitting])

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
        className="w-[400px] overflow-visible px-8 py-6"
      >
        <DialogCloseButton data-testid="invite-modal-close" className="top-6 right-8" />
        <div className="mb-2 pr-8">
          <DialogTitle className="text-xl font-semibold text-text-primary">
            {t('members.inviteTeamMember', { ns: 'common' })}
          </DialogTitle>
        </div>
        <div className="mb-3 text-[13px] text-text-tertiary">{t('members.inviteTeamMemberTip', { ns: 'common' })}</div>
        {!isEmailSetup && (
          <div className="grow basis-0 overflow-y-auto pb-4">
            <div className="relative mb-1 rounded-xl border border-components-panel-border p-2 shadow-xs">
              <div className="absolute top-0 left-0 h-full w-full rounded-xl opacity-40" style={{ background: 'linear-gradient(92deg, rgba(255, 171, 0, 0.25) 18.12%, rgba(255, 255, 255, 0.00) 167.31%)' }}></div>
              <div className="relative flex h-full w-full items-start">
                <div className="mr-0.5 shrink-0 p-0.5">
                  <div className="i-ri-error-warning-fill h-5 w-5 text-text-warning" />
                </div>
                <div className="system-xs-medium text-text-primary">
                  <span>{t('members.emailNotSetup', { ns: 'common' })}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 text-sm font-medium text-text-primary">{t('members.email', { ns: 'common' })}</div>
          <div className="mb-8 flex h-36 flex-col items-stretch">
            <ReactMultiEmail
              className={cn('h-full w-full border-components-input-border-active bg-components-input-bg-normal! px-3 pt-2 outline-hidden', 'appearance-none overflow-y-auto rounded-lg text-sm text-text-primary!')}
              autoFocus
              emails={emails}
              inputClassName="bg-transparent"
              onChange={setEmails}
              getLabel={(email, index, removeEmail) => (
                <div data-tag key={index} className={cn('bg-components-button-secondary-bg!')}>
                  <div data-tag-item>{email}</div>
                  <span
                    data-testid="remove-email-btn"
                    data-tag-handle
                    onClick={() => removeEmail(index)}
                  >
                    ×
                  </span>
                </div>
              )}
              placeholder={t('members.emailPlaceholder', { ns: 'common' }) || ''}
            />
            <div className={
              cn('flex items-center justify-end system-xs-regular text-text-tertiary', (isLimited && usedSize > licenseLimit.workspace_members.limit) ? 'text-text-destructive' : '')
            }
            >
              <span>{usedSize}</span>
              <span>/</span>
              <span>{isLimited ? licenseLimit.workspace_members.limit : t('license.unlimited', { ns: 'common' })}</span>
            </div>
          </div>
          <div className="mb-6">
            <RoleSelector value={role} onChange={setRole} />
          </div>
          <Button
            tabIndex={0}
            className="w-full"
            onClick={handleSend}
            disabled={!emails.length || isLimitExceeded || isSubmitting}
            variant="primary"
          >
            {t('members.sendInvite', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default InviteModal
