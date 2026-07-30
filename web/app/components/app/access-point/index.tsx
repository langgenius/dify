'use client'

import { Tabs, TabsList, TabsTab } from '@langgenius/dify-ui/tabs'
import { useAtomValue } from 'jotai'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useTranslation } from 'react-i18next'
import { MOCK_ENVIRONMENT_DEPLOYMENTS } from '@/app/components/app/deploy/mock-data'
import { useStore as useAppStore } from '@/app/components/app/store'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import { BuiltInAccessPoints } from './built-in-access-points'
import { DeployedEnvironmentAccessPoints } from './deployed-environment-access-points'

// todo: mock data, remove after backend is ready
const ENVIRONMENT_IDS = [
  'built-in',
  'staging',
  'pre-release',
  'canary',
  'prod',
  'eu-prod',
  'qa',
  'sandbox',
  'preview',
] as const

type EnvironmentId = (typeof ENVIRONMENT_IDS)[number]

const environmentQueryState = parseAsStringLiteral(ENVIRONMENT_IDS)
  .withDefault('built-in')
  .withOptions({ clearOnDefault: true })

const environmentNames = new Map<EnvironmentId, string>([
  ...MOCK_ENVIRONMENT_DEPLOYMENTS.map(
    (environment) => [environment.id as EnvironmentId, environment.name] as const,
  ),
])

type AccessPointProps = {
  appId: string
}

export default function AccessPoint({ appId }: AccessPointProps) {
  const { t } = useTranslation()
  const appDetail = useAppStore((state) => state.appDetail)
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const [environment, setEnvironment] = useQueryState('environment', environmentQueryState)
  const canDeploy = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }).canDeploy
  const showEnvironmentTabs = appDetail?.mode === AppModeEnum.WORKFLOW && canDeploy

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
            value={environment}
            onValueChange={(value) => void setEnvironment(value as EnvironmentId)}
          >
            <div className="overflow-x-auto">
              <TabsList
                aria-label={t(($) => $['studio.environments'], { ns: 'deployments' })}
                className="min-w-max gap-1"
              >
                {ENVIRONMENT_IDS.map((environmentId) => (
                  <TabsTab
                    key={environmentId}
                    value={environmentId}
                    className="h-8 rounded-lg border-b-0 px-2.5 py-0 system-sm-medium data-active:border-transparent data-active:bg-state-base-active data-active:system-sm-semibold data-active:text-text-secondary"
                  >
                    {environmentId === 'built-in'
                      ? t(($) => $['nodes.common.memories.builtIn'], { ns: 'workflow' })
                      : environmentNames.get(environmentId)}
                  </TabsTab>
                ))}
              </TabsList>
            </div>
          </Tabs>
        )}
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-6 py-2"
        data-environment={showEnvironmentTabs ? environment : 'built-in'}
      >
        {environment === 'built-in' || !showEnvironmentTabs ? (
          <BuiltInAccessPoints appId={appId} />
        ) : (
          <DeployedEnvironmentAccessPoints environmentId={environment} />
        )}
      </div>
    </main>
  )
}
