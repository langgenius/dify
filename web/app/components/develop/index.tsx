'use client'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import ApiServer from '@/app/components/develop/ApiServer'
import Doc from '@/app/components/develop/doc'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { getAppACLCapabilities } from '@/utils/permission'

type IDevelopMainProps = {
  appId: string
}

const DevelopMain = ({ appId }: IDevelopMainProps) => {
  const appDetail = useAppStore(state => state.appDetail)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const appACLCapabilities = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  })

  if (!appDetail) {
    return (
      <div className="flex h-full items-center justify-center bg-background-default">
        <Loading />
      </div>
    )
  }

  return (
    <div data-testid="develop-main" className="relative flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-solid border-b-divider-regular px-6 py-2">
        <div className="text-lg font-medium text-text-primary"></div>
        <ApiServer apiBaseUrl={appDetail.api_base_url} appId={appId} canManageApiKey={appACLCapabilities.canEdit} />
      </div>
      <div className="grow overflow-auto p-4 sm:px-10">
        <Doc appDetail={appDetail} />
      </div>
    </div>
  )
}

export default DevelopMain
