import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'

type InviteButtonProps = Omit<ButtonProps, 'children' | 'variant'>

export function InviteButton(props: InviteButtonProps) {
  const { t } = useTranslation(['workspaceMembers'])
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: workspacePermissions, isFetching: isFetchingWorkspacePermissions } = useQuery(
    consoleQuery.workspaces.current.permission.get.queryOptions({
      queryKey: [...consoleQuery.workspaces.current.permission.get.queryKey(), currentWorkspaceId],
      enabled: systemFeatures.branding.enabled && !!currentWorkspaceId,
    }),
  )
  if (systemFeatures.branding.enabled) {
    if (isFetchingWorkspacePermissions) {
      return <LoadingPlaceholder />
    }
    if (!workspacePermissions || workspacePermissions.allow_member_invite !== true) {
      return null
    }
  }
  return (
    <Button {...props} variant="primary">
      <span aria-hidden="true" className="i-ri-user-add-line size-4" />
      {t(($) => $['members.invite'], { ns: 'workspaceMembers' })}
    </Button>
  )
}
