import { Button } from '@langgenius/dify-ui/button'
import { RiUserAddLine } from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useWorkspacePermissions } from '@/service/use-workspace'

type InviteButtonProps = {
  disabled?: boolean
  onClick?: () => void
}

const InviteButton = (props: InviteButtonProps) => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: workspacePermissions, isFetching: isFetchingWorkspacePermissions } = useWorkspacePermissions(currentWorkspace!.id, systemFeatures.branding.enabled)
  if (systemFeatures.branding.enabled) {
    if (isFetchingWorkspacePermissions) {
      return <Loading />
    }
    if (!workspacePermissions || workspacePermissions.allow_member_invite !== true) {
      return null
    }
  }
  return (
    <Button variant="primary" {...props}>
      <RiUserAddLine className="mr-1 h-4 w-4" />
      {t('members.invite', { ns: 'common' })}
    </Button>
  )
}
export default InviteButton
