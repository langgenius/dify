import type { RecipientData, Recipient as RecipientItem } from '../../../types'
import { RiGroupLine } from '@remixicon/react'
import { produce } from 'immer'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import { useAppContext } from '@/context/app-context'
import { useMembers } from '@/service/use-common'
import { cn } from '@/utils/classnames'
import EmailInput from './email-input'
import MemberSelector from './member-selector'

const i18nPrefix = 'nodes.humanInput'

type Props = {
  data: RecipientData
  onChange: (data: RecipientData) => void
}

const Recipient = ({
  data,
  onChange,
}: Props) => {
  const { t } = useTranslation()
  const { userProfile, currentWorkspace } = useAppContext()
  const { data: members } = useMembers()
  const accounts = members?.accounts || []

  const handleMemberSelect = (id: string) => {
    onChange(
      produce(data, (draft) => {
        draft.items.push({
          type: 'member',
          user_id: id,
        })
      }),
    )
  }

  const handleEmailAdd = (email: string) => {
    onChange(
      produce(data, (draft) => {
        draft.items.push({
          type: 'external',
          email,
        })
      }),
    )
  }

  const handleDelete = (recipient: RecipientItem) => {
    onChange(
      produce(data, (draft) => {
        if (recipient.type === 'member')
          draft.items = draft.items.filter(item => item.user_id !== recipient.user_id)
        else if (recipient.type === 'external')
          draft.items = draft.items.filter(item => item.email !== recipient.email)
      }),
    )
  }

  return (
    <div className="space-y-1">
      <div className="rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg shadow-xs">
        <div className="flex h-10 items-center justify-between pl-3 pr-1">
          <div className="flex grow items-center gap-2">
            <RiGroupLine className="h-4 w-4 text-text-secondary" />
            <div className="system-sm-medium text-text-secondary">{t(`${i18nPrefix}.deliveryMethod.emailConfigure.memberSelector.title`, { ns: 'workflow' })}</div>
          </div>
          <div className="w-[86px]">
            <MemberSelector
              value={data.items}
              email={userProfile.email}
              list={accounts}
              onSelect={handleMemberSelect}
            />
          </div>
        </div>
        <EmailInput
          email={userProfile.email}
          value={data.items}
          list={accounts}
          onDelete={handleDelete}
          onSelect={handleMemberSelect}
          onAdd={handleEmailAdd}
        />
      </div>
      <div className="flex h-10 items-center gap-2 rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pl-2.5 pr-3 shadow-xs">
        <div className="flex h-5 w-5 items-center justify-center rounded-xl bg-components-icon-bg-blue-solid text-[14px]">
          <span className="bg-gradient-to-r from-components-avatar-shape-fill-stop-0 to-components-avatar-shape-fill-stop-100 bg-clip-text font-semibold uppercase text-shadow-shadow-1 opacity-90">{currentWorkspace?.name[0]?.toLocaleUpperCase()}</span>
        </div>
        <div className={cn('system-sm-medium grow text-text-secondary')}>{t(`${i18nPrefix}.deliveryMethod.emailConfigure.allMembers`, { workspaceName: currentWorkspace.name.replace(/'/g, '’'), ns: 'workflow' })}</div>
        <Switch
          value={data.whole_workspace}
          onChange={checked => onChange({ ...data, whole_workspace: checked })}
        />
      </div>
    </div>
  )
}

export default memo(Recipient)
