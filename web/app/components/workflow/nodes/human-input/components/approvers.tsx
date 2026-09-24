import type { ApproverConfig, ApproverRole, Recipient } from '../types'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useMembers } from '@/service/use-common'
import EmailInput from './delivery-method/recipient/email-input'

const roles: ApproverRole[] = ['owner', 'admin', 'editor', 'normal', 'dataset_operator']
const prefix = 'nodes.humanInput.approvers'

type Props = Readonly<{
  value?: ApproverConfig | null
  onChange: (value: ApproverConfig | null) => void
  readOnly: boolean
}>

const Approvers = ({ value, onChange, readOnly }: Props) => {
  const { t } = useTranslation(['workflowHumanInput'])
  const enabledId = useId()
  const { data: members } = useMembers()
  const accounts = members?.accounts || []
  const selected: Recipient[] = value
    ? [
        ...value.member_ids.map((user_id) => ({ type: 'member' as const, user_id })),
        ...value.emails.map((email) => ({ type: 'external' as const, email })),
      ]
    : []

  const updateRecipients = (recipients: Recipient[]) => {
    if (!value) return
    onChange({
      ...value,
      member_ids: recipients.flatMap((item) => item.type === 'member' && item.user_id ? [item.user_id] : []),
      emails: recipients.flatMap((item) => item.type === 'external' && item.email ? [item.email] : []),
    })
  }

  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between">
        <label htmlFor={enabledId} className="system-sm-semibold-uppercase text-text-secondary">
          {t(($) => $[`${prefix}.title`], { ns: 'workflowHumanInput' })}
        </label>
        <Switch
          id={enabledId}
          checked={!!value}
          disabled={readOnly}
          onCheckedChange={(checked) => onChange(checked ? { member_ids: [], emails: [], roles: [] } : null)}
        />
      </div>
      {value && (
        <div className="mt-2 space-y-2">
          <p className="system-xs-regular text-text-tertiary">
            {t(($) => $[`${prefix}.description`], { ns: 'workflowHumanInput' })}
          </p>
          <EmailInput
            email=""
            inputLabel={t(($) => $['nodes.humanInput.deliveryMethod.emailConfigure.memberSelector.title'], {
              ns: 'workflowHumanInput',
            })}
            value={selected}
            list={accounts}
            disabled={readOnly}
            onSelect={(userId) => {
              if (!value.member_ids.includes(userId))
                updateRecipients([...selected, { type: 'member', user_id: userId }])
            }}
            onAdd={(email) => {
              if (!value.emails.includes(email))
                updateRecipients([...selected, { type: 'external', email }])
            }}
            onDelete={(recipient) => updateRecipients(selected.filter((item) => (
              recipient.type === 'member'
                ? item.user_id !== recipient.user_id
                : item.email !== recipient.email
            )))}
          />
          <fieldset disabled={readOnly}>
            <legend className="mb-1 system-xs-medium text-text-secondary">
              {t(($) => $[`${prefix}.roles`], { ns: 'workflowHumanInput' })}
            </legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {roles.map((role) => (
                <label key={role} className="flex items-center gap-1 system-xs-regular text-text-secondary">
                  <input
                    type="checkbox"
                    checked={value.roles.includes(role)}
                    onChange={(event) => onChange({
                      ...value,
                      roles: event.target.checked
                        ? [...value.roles, role]
                        : value.roles.filter((selectedRole) => selectedRole !== role),
                    })}
                  />
                  {t(($) => $[`${prefix}.role.${role}`], { ns: 'workflowHumanInput' })}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  )
}

export default Approvers
