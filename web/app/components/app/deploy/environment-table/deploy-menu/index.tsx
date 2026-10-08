'use client'

import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import {
  appEnvironmentsIsErrorAtom,
  appEnvironmentsIsLoadingAtom,
  appEnvironmentsIsRetryingAtom,
  appEnvironmentsRefetchAtom,
  undeployedAppEnvironmentsAtom,
} from '../../state'

type EnvironmentDeployMenuProps = {
  appearance?: 'empty' | 'header'
  onSelectEnvironment: (environment: AppEnvironment) => void
}

export function EnvironmentDeployMenu({
  appearance = 'header',
  onSelectEnvironment,
}: EnvironmentDeployMenuProps) {
  const { t } = useTranslation(['deployments'])
  const { t: tCommon } = useTranslation(['common'])
  const undeployedEnvironments = useAtomValue(undeployedAppEnvironmentsAtom) ?? []
  const isLoading = useAtomValue(appEnvironmentsIsLoadingAtom)
  const isError = useAtomValue(appEnvironmentsIsErrorAtom)
  const isRetrying = useAtomValue(appEnvironmentsIsRetryingAtom)
  const refetchEnvironments = useAtomValue(appEnvironmentsRefetchAtom)
  const isEmptyState = appearance === 'empty'
  const label = tCommon(($) => $['appMenus.deploy'])

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button variant={isEmptyState ? 'secondary' : 'primary'} className="gap-0 px-2">
            <span aria-hidden className="i-ri-add-line size-4" />
            <span className="pl-1.5">{label}</span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </Button>
        }
      />
      <DropdownMenuContent
        aria-busy={isLoading || isRetrying}
        placement="bottom-end"
        sideOffset={4}
        className="w-42 p-1"
      >
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel className="px-2 py-1">
            {t(($) => $['card.notDeployed'])}
          </DropdownMenuGroupLabel>
          {isLoading ? (
            <LoadingPlaceholder className="h-7" />
          ) : isError ? (
            <div className="flex flex-col items-center">
              <p role="alert" className="px-2 py-1.5 system-xs-regular text-text-destructive">
                {t(($) => $['common.loadFailed'])}
              </p>
              <DropdownMenuItem
                closeOnClick={false}
                disabled={isRetrying}
                className="mx-0 h-6 w-fit justify-center rounded-md text-xs font-medium text-components-button-ghost-text"
                onClick={() => void refetchEnvironments()}
              >
                <span aria-hidden className="i-ri-reset-left-line size-3" />
                <span>{tCommon(($) => $['operation.retry'])}</span>
                {isRetrying && (
                  <span
                    aria-hidden
                    className="i-ri-loader-2-line size-3 animate-spin motion-reduce:animate-none"
                  />
                )}
              </DropdownMenuItem>
            </div>
          ) : undeployedEnvironments.length === 0 ? (
            <p role="status" className="px-2 py-1.5 system-xs-regular text-text-tertiary">
              {t(($) => $['deployDrawer.noNewEnvironmentAvailable'])}
            </p>
          ) : null}
          {!isLoading &&
            !isError &&
            undeployedEnvironments.map((environment) => (
              <DropdownMenuItem
                key={environment.id}
                className="mx-0 gap-2 py-1.5"
                onClick={() => onSelectEnvironment(environment)}
              >
                <span
                  aria-hidden
                  className="i-ri-instance-line size-4 shrink-0 text-text-tertiary"
                />
                <span className="grow truncate system-md-regular text-text-secondary">
                  {environment.display_name}
                </span>
              </DropdownMenuItem>
            ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
