'use client'
import { useCallback, useState } from 'react'
import { useContext } from 'use-context-selector'
import { RiCloseLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { ReactMultiEmail } from 'react-multi-email'
import { RiErrorWarningFill } from '@remixicon/react'
import RoleSelector from './role-selector'
import s from './index.module.css'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { inviteMember } from '@/service/common'
import { emailRegex } from '@/config'
import { ToastContext } from '@/app/components/base/toast'
import type { InvitationResult } from '@/models/common'
import I18n from '@/context/i18n'
import 'react-multi-email/dist/style.css'
import { noop } from 'lodash-es'

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
  const [emails, setEmails] = useState<string[]>([])
  const { notify } = useContext(ToastContext)

  const { locale } = useContext(I18n)
  const [role, setRole] = useState<string>('normal')

  const handleSend = useCallback(async () => {
    if (emails.map((email: string) => emailRegex.test(email)).every(Boolean)) {
      try {
        const { result, invitation_results } = await inviteMember({
          url: '/workspaces/current/members/invite-email',
          body: { emails, role, language: locale },
        })

        if (result === 'success') {
          onCancel()
          onSend(invitation_results)
        }
      }
      catch (e) { }
    }
    else {
      notify({ type: 'error', message: t('common.members.emailInvalid') })
    }
  }, [role, emails, notify, onCancel, onSend, t])

  return (
    <div className={cn(s.wrap)}>
      <Modal overflowVisible isShow onClose={noop} className={cn(s.modal)}>
        <div className='mb-2 flex justify-between'>
          <div className='text-xl font-semibold text-text-primary'>{t('common.members.inviteTeamMember')}</div>
          <RiCloseLine className='h-4 w-4 cursor-pointer text-text-tertiary' onClick={onCancel} />
        </div>
        <div className='mb-3 text-[13px] text-text-tertiary'>{t('common.members.inviteTeamMemberTip')}</div>
        {!isEmailSetup && (
          <div className='grow basis-0 overflow-y-auto pb-4'>
            <div className='relative mb-1 rounded-xl border border-components-panel-border p-2 shadow-xs'>
              <div className='absolute left-0 top-0 h-full w-full rounded-xl opacity-40' style={{ background: 'linear-gradient(92deg, rgba(255, 171, 0, 0.25) 18.12%, rgba(255, 255, 255, 0.00) 167.31%)' }}></div>
              <div className='relative flex h-full w-full items-start'>
                <div className='mr-0.5 shrink-0 p-0.5'>
                  <RiErrorWarningFill className='h-5 w-5 text-text-warning' />
                </div>
                <div className='system-xs-medium text-text-primary'>
                  <span>{t('common.members.emailNotSetup')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className='mb-2 text-sm font-medium text-text-primary'>{t('common.members.email')}</div>
          <div className='mb-8 flex h-36 items-stretch'>
            <ReactMultiEmail
              className={cn('w-full border-components-input-border-active !bg-components-input-bg-normal px-3 pt-2 outline-none',
                'appearance-none overflow-y-auto rounded-lg text-sm !text-text-primary',
              )}
              autoFocus
              emails={emails}
              inputClassName='bg-transparent'
              onChange={setEmails}
              getLabel={(email, index, removeEmail) =>
                <div data-tag key={index} className={cn('bg-components-button-secondary-bg')}>
                  <div data-tag-item>{email}</div>
                  <span data-tag-handle onClick={() => removeEmail(index)}>
                    ×
                  </span>
                </div>
              }
              placeholder={t('common.members.emailPlaceholder') || ''}
            />
          </div>
          <div className='mb-6'>
            <RoleSelector value={role} onChange={setRole} />
          </div>
          <Button
            tabIndex={0}
            className='w-full'
            onClick={handleSend}
            disabled={!emails.length}
            variant='primary'
          >
            {t('common.members.sendInvite')}
          </Button>
        </div>
      </Modal>
    </div>
  )
}

export default InviteModal
