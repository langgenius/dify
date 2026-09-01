import type { EnvironmentDeployment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useTranslation } from 'react-i18next'
import SuggestedAction from '../suggested-action'

function environmentHref(path: string, appId: string, environmentId: string) {
  return `/app/${appId}/${path}?environment=${encodeURIComponent(environmentId)}`
}

export function PublisherEnvironmentActionsSection({
  appId,
  deployment,
  environmentId,
}: {
  appId?: string
  deployment?: EnvironmentDeployment
  environmentId: string
}) {
  const { t } = useTranslation()
  const actionsDisabled = !appId || !deployment
  const accessPointHref = appId ? environmentHref('access-point', appId, environmentId) : undefined
  const deployHref = appId ? environmentHref('deploy', appId, environmentId) : undefined

  return (
    <div className="flex flex-col border-t-[0.5px] border-t-divider-regular p-3">
      <SuggestedAction
        disabled={actionsDisabled}
        description={t(($) => $['common.accessPointDescription'], { ns: 'workflow' })}
        link={accessPointHref}
        icon={<span className="i-custom-vender-agent-v2-access-point size-4" />}
      >
        {t(($) => $['appMenus.accessPoint'], { ns: 'common' })}
      </SuggestedAction>
      <SuggestedAction
        disabled={actionsDisabled}
        description={t(($) => $['common.deployDescription'], { ns: 'workflow' })}
        link={deployHref}
        icon={<span className="i-ri-instance-line size-4" />}
      >
        {t(($) => $['appMenus.deploy'], { ns: 'common' })}
      </SuggestedAction>
    </div>
  )
}
