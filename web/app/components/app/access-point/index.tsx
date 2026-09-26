'use client'

import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { Tabs, TabsList, TabsTab } from '@langgenius/dify-ui/tabs'
import { useAtomValue } from 'jotai'
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { ACCESS_POINT_ORDER } from '@/app/components/app/deploy/utils/access-point'
import { BuiltInAccessPoints } from './built-in-access-points'
import { DeployedEnvironmentAccessPoints } from './deployed-environment-access-points'
import {
  accessPointCapabilitiesAtom,
  accessPointEnvironmentQueryEnabledAtom,
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
  canDeploy: boolean
  canManageAccessPoint: boolean
  canReleaseAndVersion: boolean
  showEnvironmentTabs: boolean
}

function AccessPointContent({
  appId,
  canDeploy,
  canManageAccessPoint,
  canReleaseAndVersion,
  showEnvironmentTabs,
}: AccessPointContentProps) {
  const { t } = useTranslation(['common', 'deployments', 'workflow'])
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
    <div className="flex h-full min-h-0 flex-col bg-components-panel-bg">
      <header className="flex shrink-0 flex-col gap-3 px-6 pt-3 pb-2">
        <div className="flex flex-col gap-0.5">
          <div className="flex h-6 items-center">
            <h1 id="access-point-title" className="title-xl-semi-bold text-text-primary">
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

      <ScrollArea className="relative min-h-0 flex-1 overflow-hidden">
        <ScrollAreaViewport
          aria-labelledby="access-point-title"
          className="overscroll-contain"
          data-environment={selectedEnvironment}
          role="region"
          style={{ overflowX: 'hidden' }}
        >
          <ScrollAreaContent
            className="min-h-full w-full max-w-full px-6 py-2"
            style={{ minWidth: 0 }}
          >
            {selectedEnvironment === BUILT_IN_ENVIRONMENT_ID ? (
              <BuiltInAccessPoints
                appId={appId}
                canDeploy={canDeploy}
                canManageAccessPoint={canManageAccessPoint}
                canReleaseAndVersion={canReleaseAndVersion}
                highlightedAccessPoint={selectedHighlightedAccessPoint}
              />
            ) : (
              <DeployedEnvironmentAccessPoints
                appId={appId}
                environmentId={selectedEnvironment}
                canManageAccessPoint={canManageAccessPoint}
                highlightedAccessPoint={selectedHighlightedAccessPoint}
              />
            )}
          </ScrollAreaContent>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar>
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollArea>
    </div>
  )
}

function AccessPointView({ appId }: AccessPointProps) {
  const capabilities = useAtomValue(accessPointCapabilitiesAtom)
  const showEnvironmentTabs = useAtomValue(accessPointEnvironmentQueryEnabledAtom)
  return (
    <AccessPointContent
      appId={appId}
      canDeploy={capabilities.canDeploy}
      canManageAccessPoint={capabilities.canManageAccessPoint}
      canReleaseAndVersion={capabilities.canReleaseAndVersion}
      showEnvironmentTabs={showEnvironmentTabs}
    />
  )
}

export default function AccessPoint({ appId }: AccessPointProps) {
  return (
    <AccessPointStateBoundary appId={appId}>
      <AccessPointView appId={appId} />
    </AccessPointStateBoundary>
  )
}
