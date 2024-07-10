'use client'
import { useCallback, useState } from 'react'
import { useContext } from 'use-context-selector'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { ReactMultiEmail } from 'react-multi-email'
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
type IInviteModalProps = {
  onCancel: () => void
  onSend: (invitationResults: InvitationResult[]) => void
}

const InviteModal = ({
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
      <Modal overflowVisible isShow onClose={() => { }} className={cn(s.modal)}>
        <div className='flex justify-between mb-2'>
          <div className='text-xl font-semibold text-gray-900'>{t('common.members.inviteTeamMember')}</div>
          <XMarkIcon className='w-4 h-4 cursor-pointer' onClick={onCancel} />
        </div>
        <div className='mb-7 text-[13px] text-gray-500'>{t('common.members.inviteTeamMemberTip')}</div>
        <div>
          <div className='mb-2 text-sm font-medium text-gray-900'>{t('common.members.email')}</div>
          <div className='mb-8 h-36 flex items-stretch'>
            <ReactMultiEmail
              className={cn('w-full pt-2 px-3 outline-none border-none',
                'appearance-none text-sm text-gray-900 rounded-lg overflow-y-auto',
                s.emailsInput,
              )}
              autoFocus
              emails={emails}
              inputClassName='bg-transparent'
              onChange={setEmails}
              getLabel={(email, index, removeEmail) =>
                <div data-tag key={index} className={cn(s.emailBackground)}>
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
