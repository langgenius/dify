import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useWorkspacePermissions } from '@/service/use-workspace'

type InviteButtonProps = Omit<ButtonProps, 'children' | 'variant'>

const InviteButton = (props: InviteButtonProps) => {
  const { t } = useTranslation()
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: workspacePermissions, isFetching: isFetchingWorkspacePermissions } =
    useWorkspacePermissions(currentWorkspaceId, systemFeatures.branding.enabled)
  if (systemFeatures.branding.enabled) {
    if (isFetchingWorkspacePermissions) {
      return <Loading />
    }
    if (!workspacePermissions || workspacePermissions.allow_member_invite !== true) {
      return null
    }
  }
  return (
    <Button {...props} variant="primary">
      <span aria-hidden="true" className="mr-1 i-ri-user-add-line size-4" />
      {t(($) => $['members.invite'], { ns: 'common' })}
    </Button>
  )
}
export default InviteButton
