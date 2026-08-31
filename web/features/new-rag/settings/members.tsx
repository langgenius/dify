'use client'

import type { KnowledgeFsControlSpaceVisibility } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Member } from '@/models/common'
import { useTranslation } from 'react-i18next'
import PermissionSelector from '@/app/components/datasets/settings/permission-selector'

type KnowledgeSettingsMembersProps = {
  disabled: boolean
  hasError: boolean
  members: Member[]
  ownerAccountId: string
  selectedMemberIds: string[]
  visibility: KnowledgeFsControlSpaceVisibility
  onSelectedMemberIdsChange: (memberIds: string[]) => void
  onVisibilityChange: (visibility: KnowledgeFsControlSpaceVisibility) => void
}

const MEMBERS_ERROR_ID = 'knowledge-settings-members-error'

export function KnowledgeSettingsMembers({
  disabled,
  hasError,
  members,
  ownerAccountId,
  selectedMemberIds,
  visibility,
  onSelectedMemberIdsChange,
  onVisibilityChange,
}: KnowledgeSettingsMembersProps) {
  const { t } = useTranslation('dataset')

  return (
    <div className="min-w-0 flex-1">
      <PermissionSelector
        ariaDescribedBy={hasError ? MEMBERS_ERROR_ID : undefined}
        disabled={disabled}
        disableWhenRbacEnabled={false}
        invalid={hasError}
        memberList={members}
        permission={visibility}
        value={selectedMemberIds}
        onChange={(permission) => {
          if (permission) onVisibilityChange(permission as KnowledgeFsControlSpaceVisibility)
        }}
        onMemberSelect={(memberIds) =>
          onSelectedMemberIdsChange(memberIds.filter((memberId) => memberId !== ownerAccountId))
        }
      />

      {visibility === 'partial_members' && hasError && (
        <p
          id={MEMBERS_ERROR_ID}
          className="mt-1 system-xs-regular text-text-destructive"
          role="alert"
        >
          {t(($) => $['newKnowledge.settings.membersRequired'])}
        </p>
      )}
    </div>
  )
}
