import { RiUserAddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useWorkspacePermissions } from '@/service/use-workspace'

type InviteButtonProps = {
  disabled?: boolean
  onClick?: () => void
}

const InviteButton = (props: InviteButtonProps) => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
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
