'use client'

import type {
  Environment,
  EnvironmentDeployment,
  Release,
} from '@dify/contracts/enterprise/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { environmentId, environmentName } from '../../environment'
import { releaseDeploymentAction } from '../../release-action'
import { deploymentStatus, isUndeployedDeploymentRow } from '../../runtime-status'
import { openDeployDrawerAtom } from '../../store'
import { DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME } from '../table-styles'
import { exportReleaseDsl } from './release-dsl-export'

type EnvironmentOption = Environment & {
  id: string
}

type DeployMenuRowState = 'promote' | 'deploy' | 'rollback' | 'current' | 'deploying'

type DeployMenuRow = {
  env: EnvironmentOption
  state: DeployMenuRowState
  label: string
  disabledReason?: string
}

type DeployMenuGroup = 'promote' | 'deploy' | 'rollback' | 'unavailable'

const GROUP_ORDER: DeployMenuGroup[] = ['promote', 'deploy', 'rollback', 'unavailable']

function stateToGroup(state: DeployMenuRowState): DeployMenuGroup {
  if (state === 'promote')
    return 'promote'
  if (state === 'rollback')
    return 'rollback'
  if (state === 'deploy')
    return 'deploy'
  return 'unavailable'
}

export function DeployReleaseMenu({ appInstanceId, releaseId, releaseRows }: {
  appInstanceId: string
  releaseId: string
  releaseRows: Release[]
}) {
  const { t } = useTranslation('deployments')
  const openDeployDrawer = useSetAtom(openDeployDrawerAtom)
  const [open, setOpen] = useState(false)
  const [isExportingDsl, setIsExportingDsl] = useState(false)
  const { data: environmentDeployments } = useQuery(consoleQuery.enterprise.deploymentService.listEnvironmentDeployments.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: open,
  }))
  const { data: appInstanceData } = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: open,
  }))

  const environments: EnvironmentOption[] = (environmentDeployments?.data ?? [])
    .map(row => row.environment)
    .filter((env): env is EnvironmentOption => Boolean(env?.id))
  const deploymentRows = environmentDeployments?.data?.filter(row => Boolean(row.environment?.id) && !isUndeployedDeploymentRow(row)) ?? []
  const targetRelease = releaseRows.find((release): release is Release & { id: string } => release.id === releaseId)
  const appInstanceName = appInstanceData?.appInstance?.name

  if (!targetRelease)
    return null

  const handleExportDsl = async () => {
    if (isExportingDsl)
      return

    setIsExportingDsl(true)
    try {
      await exportReleaseDsl({ release: targetRelease, appInstanceName })
      setOpen(false)
    }
    catch {
      toast.error(t('versions.exportDslFailed'))
    }
    finally {
      setIsExportingDsl(false)
    }
  }

  const menuRows: DeployMenuRow[] = environments.map((env) => {
    const envId = env.id
    const envName = environmentName(env)
    const row: EnvironmentDeployment | undefined = deploymentRows.find(item => environmentId(item.environment) === envId)
    const currentRelease = row?.currentRelease
    const isCurrent = currentRelease?.id === releaseId
    const isEnvironmentDeploying = row ? deploymentStatus(row) === 'deploying' : false

    if (isEnvironmentDeploying) {
      return {
        env,
        state: 'deploying',
        label: t('versions.deployingTo', { name: envName }),
        disabledReason: t('versions.disabledReason.deploying'),
      }
    }
    if (isCurrent) {
      return {
        env,
        state: 'current',
        label: t('versions.currentOn', { name: envName }),
        disabledReason: t('versions.disabledReason.current', { name: envName }),
      }
    }

    const action = releaseDeploymentAction({
      targetRelease,
      currentRelease,
      releaseRows,
      isExistingRelease: true,
    })

    if (!row) {
      return {
        env,
        state: 'deploy',
        label: t('versions.deployTo', { name: envName }),
      }
    }
    if (action === 'rollback') {
      return {
        env,
        state: 'rollback',
        label: t('versions.rollbackTo', { name: envName }),
      }
    }
    return {
      env,
      state: 'promote',
      label: t('versions.promoteTo', { name: envName }),
    }
  })

  const groupedRows = GROUP_ORDER.map(group => ({
    group,
    rows: menuRows.filter(row => stateToGroup(row.state) === group),
  })).filter(section => section.rows.length > 0)

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={t('versions.moreActions')}
        className={DETAIL_TABLE_ACTION_TRIGGER_CLASS_NAME}
      >
        <span aria-hidden className="i-ri-more-fill size-4" />
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-60">
          <DropdownMenuItem
            disabled={isExportingDsl}
            aria-disabled={isExportingDsl}
            className={cn(
              'gap-2 px-3',
              isExportingDsl && 'cursor-not-allowed opacity-60',
            )}
            onClick={handleExportDsl}
          >
            <span aria-hidden className="i-ri-download-2-line size-4 shrink-0 text-text-tertiary" />
            <span className="system-sm-regular text-text-secondary">
              {isExportingDsl ? t('versions.exportingDsl') : t('versions.exportDsl')}
            </span>
          </DropdownMenuItem>
          {groupedRows.length > 0 && <div className="my-1 border-t border-divider-subtle" aria-hidden />}
          {groupedRows.map((section, sectionIndex) => (
            <div key={section.group}>
              {sectionIndex > 0 && <div className="my-1 border-t border-divider-subtle" aria-hidden />}
              <div className="px-3 pt-1.5 pb-1 system-2xs-medium-uppercase text-text-quaternary">
                {t(`versions.groupHeader.${section.group}`)}
              </div>
              {section.rows.map((row) => {
                const isDisabled = row.state === 'current' || row.state === 'deploying'
                return (
                  <DropdownMenuItem
                    key={row.env.id}
                    disabled={isDisabled}
                    title={isDisabled ? row.disabledReason : undefined}
                    aria-disabled={isDisabled}
                    className={cn(
                      'gap-2 px-3',
                      isDisabled && 'cursor-not-allowed opacity-60',
                    )}
                    onClick={() => {
                      if (isDisabled)
                        return
                      setOpen(false)
                      openDeployDrawer({ appInstanceId, environmentId: row.env.id, releaseId })
                    }}
                  >
                    <span className="system-sm-regular text-text-secondary">
                      {row.label}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
