'use client'

import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
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
  const { t } = useTranslation('deployments')
  const { t: tCommon } = useTranslation('common')
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
        popupClassName="w-42 rounded-xl p-1"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1 system-xs-medium-uppercase text-text-tertiary">
            {t(($) => $['card.notDeployed'])}
          </DropdownMenuLabel>
          {isLoading ? (
            <Loading className="h-7" />
          ) : isError ? (
            <div className="flex flex-col items-center">
              <p role="alert" className="px-2 py-1.5 system-xs-regular text-text-destructive">
                {t(($) => $['common.loadFailed'])}
              </p>
              <Button
                type="button"
                size="small"
                variant="ghost"
                loading={isRetrying}
                disabled={isRetrying}
                className="gap-1 px-2"
                onClick={() => void refetchEnvironments()}
              >
                <span aria-hidden className="i-ri-reset-left-line size-3" />
                <span>{tCommon(($) => $['operation.retry'])}</span>
              </Button>
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
                className="mx-0 flex gap-2 px-2 py-1.5"
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
