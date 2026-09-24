import type { KnowledgeVisibility } from './workflow'
import { Button } from '@langgenius/dify-ui/button'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import PermissionSelector from '@/app/components/datasets/settings/permission-selector'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/console'

type KnowledgeCreationPermissionsProps = {
  canConfigureAccess: boolean
  disabled: boolean
  selectedMemberIds: string[]
  visibility: KnowledgeVisibility
  onSelectedMemberIdsChange: (memberIds: string[]) => void
  onVisibilityChange: (visibility: KnowledgeVisibility) => void
}

export function KnowledgeCreationPermissions({
  canConfigureAccess,
  disabled,
  selectedMemberIds,
  visibility,
  onSelectedMemberIdsChange,
  onVisibilityChange,
}: KnowledgeCreationPermissionsProps) {
  const { t } = useTranslation(['knowledgeSpace', 'knowledgeSettings'])
  const { t: tCommon } = useTranslation(['common'])
  const labelId = useId()
  const descriptionId = useId()
  const membersErrorId = useId()
  const { data: ownerAccountId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const membersQuery = useQuery(
    consoleQuery.workspaces.current.members.get.queryOptions({ enabled: canConfigureAccess }),
  )
  const membersInvalid = visibility === 'partial_members' && selectedMemberIds.length === 0

  return (
    <Fieldset className="gap-1.5">
      <FieldsetLegend id={labelId}>{t(($) => $.permission)}</FieldsetLegend>
      {membersQuery.isLoading ? (
        <SkeletonRectangle className="h-9 w-full rounded-lg" />
      ) : (
        <PermissionSelector
          ariaLabelledBy={labelId}
          ariaDescribedBy={
            !canConfigureAccess ? descriptionId : membersInvalid ? membersErrorId : undefined
          }
          disabled={disabled || !canConfigureAccess}
          disableWhenRbacEnabled={false}
          invalid={membersInvalid}
          memberList={membersQuery.data?.accounts ?? []}
          permission={visibility}
          value={selectedMemberIds}
          onChange={(permission) => {
            if (permission) onVisibilityChange(permission as KnowledgeVisibility)
          }}
          onMemberSelect={(memberIds) =>
            onSelectedMemberIdsChange(memberIds.filter((memberId) => memberId !== ownerAccountId))
          }
        />
      )}
      {membersInvalid && (
        <p id={membersErrorId} className="system-xs-regular text-text-destructive" role="alert">
          {t(($) => $['settings.membersRequired'], { ns: 'knowledgeSettings' })}
        </p>
      )}
      {canConfigureAccess && membersQuery.isError && (
        <div
          className="flex items-center gap-2 system-xs-regular text-text-destructive"
          role="alert"
        >
          <span>{tCommon(($) => $['api.actionFailed'])}</span>
          <Button type="button" disabled={disabled} onClick={() => void membersQuery.refetch()}>
            {tCommon(($) => $['operation.retry'])}
          </Button>
        </div>
      )}
      {!canConfigureAccess && (
        <p id={descriptionId} className="py-0.5 body-xs-regular text-text-tertiary">
          {t(($) => $.permissionRestricted)}
        </p>
      )}
    </Fieldset>
  )
}
