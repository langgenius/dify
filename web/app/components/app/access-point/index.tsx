'use client'

import { Tabs, TabsList, TabsTab } from '@langgenius/dify-ui/tabs'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/access-point'
import { useStore as useAppStore } from '@/app/components/app/store'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { BuiltInAccessPoints } from './built-in-access-points'
import { DeployedEnvironmentAccessPoints } from './deployed-environment-access-points'
import {
  AccessPointStateBoundary,
  BUILT_IN_ENVIRONMENT_ID,
  inUseAppEnvironmentsAtom,
} from './state'

const environmentQueryState = parseAsString
  .withDefault(BUILT_IN_ENVIRONMENT_ID)
  .withOptions({ clearOnDefault: true })
const accessPointQueryState = parseAsStringLiteral(ACCESS_POINT_ORDER)
const accessPointQueryStates = {
  environment: environmentQueryState,
  accessPoint: accessPointQueryState,
}

type AccessPointProps = {
  appId: string
}

type AccessPointContentProps = AccessPointProps & {
  canEdit: boolean
  canManage: boolean
  showEnvironmentTabs: boolean
}

function AccessPointContent({
  appId,
  canEdit,
  canManage,
  showEnvironmentTabs,
}: AccessPointContentProps) {
  const { t } = useTranslation()
  const environments = useAtomValue(inUseAppEnvironmentsAtom)
  const [queryStates, setQueryStates] = useQueryStates(accessPointQueryStates)
  const { accessPoint: highlightedAccessPoint, environment } = queryStates
  const selectedEnvironment =
    showEnvironmentTabs &&
    (environment === BUILT_IN_ENVIRONMENT_ID ||
      environments.some((candidate) => candidate.id === environment))
      ? environment
      : BUILT_IN_ENVIRONMENT_ID
  const selectedHighlightedAccessPoint =
    environment === selectedEnvironment ? highlightedAccessPoint : null

  return (
    <main className="flex h-full min-h-0 flex-col bg-components-panel-bg">
      <header className="flex shrink-0 flex-col gap-3 px-6 pt-3 pb-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex h-6 items-center">
            <h1 className="title-xl-semi-bold text-text-primary">
              {t(($) => $['appMenus.accessPoint'], { ns: 'common' })}
            </h1>
          </div>
          <p className="system-xs-regular text-text-tertiary">
            {t(($) => $['studio.accessPoint.description'], { ns: 'deployments' })}
          </p>
        </div>
        {showEnvironmentTabs && (
          <Tabs
            value={selectedEnvironment}
            onValueChange={(environment) => void setQueryStates({ accessPoint: null, environment })}
          >
            <div className="overflow-x-auto">
              <TabsList
                aria-label={t(($) => $['studio.environments'], { ns: 'deployments' })}
                className="min-w-max gap-1"
              >
                <TabsTab
                  value={BUILT_IN_ENVIRONMENT_ID}
                  className="h-8 rounded-lg border-b-0 px-2.5 py-0 system-sm-medium data-active:border-transparent data-active:bg-state-base-active data-active:system-sm-semibold data-active:text-text-secondary"
                >
                  {t(($) => $['nodes.common.memories.builtIn'], { ns: 'workflow' })}
                </TabsTab>
                {environments.map((environment) => (
                  <TabsTab
                    key={environment.id}
                    value={environment.id}
                    className="h-8 rounded-lg border-b-0 px-2.5 py-0 system-sm-medium data-active:border-transparent data-active:bg-state-base-active data-active:system-sm-semibold data-active:text-text-secondary"
                  >
                    {environment.display_name}
                  </TabsTab>
                ))}
              </TabsList>
            </div>
          </Tabs>
        )}
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-6 py-2"
        data-environment={selectedEnvironment}
      >
        {selectedEnvironment === BUILT_IN_ENVIRONMENT_ID ? (
          <BuiltInAccessPoints
            appId={appId}
            highlightedAccessPoint={selectedHighlightedAccessPoint}
          />
        ) : (
          <DeployedEnvironmentAccessPoints
            appId={appId}
            environmentId={selectedEnvironment}
            canEdit={canEdit}
            canManage={canManage}
            highlightedAccessPoint={selectedHighlightedAccessPoint}
          />
        )}
      </div>
    </main>
  )
}

export default function AccessPoint({ appId }: AccessPointProps) {
  const appDetail = useAppStore((state) => state.appDetail)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const capabilities = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  })
  const showEnvironmentTabs = appDetail?.mode === AppModeEnum.WORKFLOW && capabilities.canDeploy

  return (
    <AccessPointStateBoundary appId={appId} environmentQueryEnabled={showEnvironmentTabs}>
      <AccessPointContent
        appId={appId}
        canEdit={capabilities.canEdit}
        canManage={capabilities.canDeploy}
        showEnvironmentTabs={showEnvironmentTabs}
      />
    </AccessPointStateBoundary>
  )
}
