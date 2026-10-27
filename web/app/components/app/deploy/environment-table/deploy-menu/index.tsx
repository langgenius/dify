'use client'

import type { OpenDeploymentDialog } from '../../types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useAtomValue } from 'jotai'
import { useRef } from 'react'
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
  onOpenDeployment: OpenDeploymentDialog
}

export function EnvironmentDeployMenu({
  appearance = 'header',
  onOpenDeployment,
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
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  return (
    <Menu modal={false}>
      <MenuTrigger
        render={
          <Button
            ref={triggerRef}
            variant={isEmptyState ? 'secondary' : 'primary'}
            className="gap-0 px-2"
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            <span className="pl-1.5">{label}</span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
          </Button>
        }
      />
      <MenuContent
        align={isEmptyState ? undefined : 'end'}
        aria-busy={isLoading || isRetrying}
        className="w-42"
      >
        <MenuGroup>
          <MenuGroupLabel className="py-1">{t(($) => $['card.notDeployed'])}</MenuGroupLabel>
          {isLoading ? (
            <LoadingPlaceholder className="mx-1 h-7" />
          ) : isError ? (
            <div className="flex flex-col items-center">
              <p role="alert" className="px-3 py-1.5 system-xs-regular text-text-destructive">
                {t(($) => $['common.loadFailed'])}
              </p>
              <MenuItem
                closeOnClick={false}
                disabled={isRetrying}
                className="h-6 w-fit justify-center rounded-md text-xs font-medium text-components-button-ghost-text"
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
              </MenuItem>
            </div>
          ) : undeployedEnvironments.length === 0 ? (
            <p role="status" className="px-3 py-1.5 system-xs-regular text-text-tertiary">
              {t(($) => $['deployDrawer.noNewEnvironmentAvailable'])}
            </p>
          ) : null}
          {!isLoading &&
            !isError &&
            undeployedEnvironments.map((environment) => (
              <MenuItem
                key={environment.id}
                className="gap-2 py-1.5"
                onClick={() => {
                  onOpenDeployment(
                    {
                      environment: environment.display_name,
                      environmentId: environment.id,
                      kind: 'deploy',
                    },
                    triggerRef.current,
                  )
                }}
              >
                <span
                  aria-hidden
                  className="i-ri-instance-line size-4 shrink-0 text-text-tertiary"
                />
                <span className="grow truncate system-md-regular text-text-secondary">
                  {environment.display_name}
                </span>
              </MenuItem>
            ))}
        </MenuGroup>
      </MenuContent>
    </Menu>
  )
}
