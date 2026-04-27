'use client'
import type { FC } from 'react'
import type { AppInfo, Deployment, DeployStatus, Environment, Instance } from './types'
import type { AppModeEnum } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useDebounceFn } from 'ahooks'
import { parseAsString, useQueryState } from 'nuqs'
import * as React from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import Input from '@/app/components/base/input'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useRouter } from '@/next/navigation'
import CreateInstanceModal from './create-instance-modal'
import DeployDrawer from './deploy-drawer'
import RollbackModal from './rollback-modal'
import { useDeploymentsStore } from './store'
import { useSourceApps } from './use-source-apps'

type NewInstanceCardProps = {
  onOpen: () => void
}

type NewInstanceActionProps = {
  icon: string
  label: string
  disabled?: boolean
  onClick?: () => void
}

const NewInstanceAction: FC<NewInstanceActionProps> = ({ icon, label, disabled, onClick }) => {
  const { t } = useTranslation('deployments')

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? t('newInstance.comingSoon') : undefined}
      className={cn(
        'mb-1 flex w-full items-center rounded-lg px-6 py-[7px] text-left text-[13px] leading-[18px] font-medium text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
        disabled
          ? 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-text-tertiary'
          : 'cursor-pointer',
      )}
    >
      <span aria-hidden className={cn('mr-2 h-4 w-4 shrink-0', icon)} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {disabled && (
        <span className="ml-2 shrink-0 rounded-md bg-state-base-hover px-1.5 system-2xs-medium text-text-tertiary">
          {t('newInstance.comingSoon')}
        </span>
      )}
    </button>
  )
}

const NewInstanceCard: FC<NewInstanceCardProps> = ({ onOpen }) => {
  const { t } = useTranslation('deployments')
  return (
    <div className="relative col-span-1 inline-flex h-[160px] flex-col justify-between rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg">
      <div className="grow rounded-t-xl p-2">
        <div className="px-6 pt-2 pb-1 text-xs leading-[18px] font-medium text-text-tertiary">
          {t('newInstance.title')}
        </div>
        <NewInstanceAction
          icon="i-ri-stack-line"
          label={t('newInstance.fromStudio')}
          onClick={onOpen}
        />
        <NewInstanceAction
          icon="i-ri-github-fill"
          label={t('newInstance.fromGitHub')}
          disabled
        />
        <NewInstanceAction
          icon="i-ri-file-code-line"
          label={t('newInstance.importDSL')}
          disabled
        />
      </div>
    </div>
  )
}

type InstanceCardProps = {
  instance: Instance
  app: AppInfo
  deployments: Deployment[]
  environments: Environment[]
}

const InstanceCard: FC<InstanceCardProps> = ({ instance, app, deployments, environments }) => {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const [menuOpen, setMenuOpen] = useState(false)
  const openDeployDrawer = useDeploymentsStore(state => state.openDeployDrawer)
  const deleteInstance = useDeploymentsStore(state => state.deleteInstance)

  const navigateToDetail = () => router.push(`/deployments/${instance.id}/overview`)

  const handleMenuAction = (e: React.MouseEvent<HTMLElement>, action: () => void) => {
    e.stopPropagation()
    e.preventDefault()
    setMenuOpen(false)
    action()
  }

  const envCount = deployments.length
  const failedCount = deployments.filter(d => d.status === 'deploy_failed').length
  const deployingCount = deployments.filter(d => d.status === 'deploying').length
  const readyCount = deployments.filter(d => d.status === 'ready').length
  const envMap = useMemo(() => new Map(environments.map(env => [env.id, env])), [environments])

  const lastDeployedAt = useMemo(() => {
    if (deployments.length === 0)
      return null
    return deployments.reduce((latest, d) => {
      const t = new Date(d.createdAt).getTime()
      return t > latest ? t : latest
    }, 0)
  }, [deployments])

  const primaryStatus: 'none' | 'failed' | 'deploying' | 'ready' = envCount === 0
    ? 'none'
    : failedCount > 0
      ? 'failed'
      : deployingCount > 0
        ? 'deploying'
        : 'ready'

  const primaryText = primaryStatus === 'none'
    ? t('card.notDeployed')
    : primaryStatus === 'failed'
      ? t('card.failed', { count: failedCount })
      : primaryStatus === 'deploying'
        ? t('card.deploying', { count: deployingCount })
        : t('card.ready', { count: readyCount })

  const secondaryParts: string[] = []
  if (primaryStatus === 'failed' && deployingCount > 0)
    secondaryParts.push(t('card.deploying', { count: deployingCount }))
  if ((primaryStatus === 'failed' || primaryStatus === 'deploying') && readyCount > 0)
    secondaryParts.push(t('card.ready', { count: readyCount }))

  const statusLabel = (status: DeployStatus) => {
    if (status === 'deploy_failed')
      return t('status.deployFailed')
    return t(`status.${status}`)
  }

  const statusTooltip = primaryStatus === 'none'
    ? t('card.tooltip.notDeployed')
    : (
        <div className="flex min-w-[220px] flex-col gap-1">
          <div className="system-xs-medium text-text-secondary">{t('overview.deploymentStatus')}</div>
          {deployments.map((deployment) => {
            const env = envMap.get(deployment.environmentId)
            return (
              <div key={deployment.id} className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-text-tertiary">
                  {env?.name ?? deployment.environmentId}
                </span>
                <span className="shrink-0 text-text-secondary">
                  {statusLabel(deployment.status)}
                  {' · '}
                  {deployment.activeReleaseId}
                </span>
              </div>
            )
          })}
        </div>
      )

  const healthPillClass = primaryStatus === 'none'
    ? 'text-text-tertiary bg-background-section-burn'
    : primaryStatus === 'failed'
      ? 'text-util-colors-red-red-700 bg-util-colors-red-red-50'
      : primaryStatus === 'deploying'
        ? 'text-util-colors-warning-warning-700 bg-util-colors-warning-warning-50'
        : 'text-util-colors-green-green-700 bg-util-colors-green-green-50'

  const healthDotClass = primaryStatus === 'none'
    ? 'bg-text-quaternary'
    : primaryStatus === 'failed'
      ? 'bg-util-colors-red-red-500'
      : primaryStatus === 'deploying'
        ? 'bg-util-colors-warning-warning-500 animate-pulse'
        : 'bg-util-colors-green-green-500'

  const appModeLabel = t(`appMode.${app.mode}`, { defaultValue: app.mode })

  return (
    <div
      onClick={(e) => {
        e.preventDefault()
        navigateToDetail()
      }}
      className="group relative col-span-1 inline-flex h-[160px] cursor-pointer flex-col rounded-xl border border-solid border-components-card-border bg-components-card-bg shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg"
    >
      <div className="flex h-[66px] shrink-0 grow-0 items-center gap-3 px-[14px] pt-[14px] pb-3">
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={app.iconType}
            icon={app.icon}
            background={app.iconBackground}
            imageUrl={app.iconUrl}
          />
          <AppTypeIcon
            type={app.mode as unknown as AppModeEnum}
            wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm"
            className="h-3 w-3"
          />
        </div>
        <div className="w-0 grow py-px">
          <div className="flex items-center text-sm leading-5 font-semibold text-text-secondary">
            <div className="truncate" title={instance.name}>{instance.name}</div>
          </div>
          <div className="truncate text-[10px] leading-[18px] font-medium text-text-tertiary" title={appModeLabel}>
            {appModeLabel}
          </div>
        </div>
      </div>
      <div className="flex grow flex-col gap-2 px-[14px]">
        <Tooltip>
          <TooltipTrigger
            render={(
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 system-xs-medium',
                    healthPillClass,
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', healthDotClass)} />
                  {primaryText}
                </span>
                {secondaryParts.length > 0 && (
                  <span className="truncate system-xs-regular text-text-tertiary">
                    {secondaryParts.join(' · ')}
                  </span>
                )}
              </div>
            )}
          />
          <TooltipContent>{statusTooltip}</TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 items-center gap-1.5 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-apps-2-line h-3.5 w-3.5 shrink-0 text-text-quaternary" />
          <span className="truncate" title={app.name}>
            {t('card.fromApp', { name: app.name })}
          </span>
        </div>
      </div>
      <div className="absolute right-0 bottom-1 left-0 flex h-[42px] shrink-0 items-center pt-1 pr-[6px] pb-[6px] pl-[14px]">
        <div className="mr-[41px] flex min-w-0 grow items-center gap-1.5 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-time-line h-3.5 w-3.5 shrink-0 text-text-quaternary" />
          <span className="truncate">
            {lastDeployedAt
              ? t('card.lastDeployed', { time: formatTimeFromNow(lastDeployedAt) })
              : t('card.neverDeployed')}
          </span>
        </div>
        <div
          className={cn(
            'absolute top-1/2 right-[6px] flex -translate-y-1/2 items-center transition-opacity',
            menuOpen
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
          )}
        >
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger
              aria-label={t('card.moreActions')}
              className={cn(
                menuOpen ? 'bg-state-base-hover shadow-none' : 'bg-transparent',
                'flex h-8 w-8 items-center justify-center rounded-md border-none p-2 hover:bg-state-base-hover',
              )}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            >
              <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
            </DropdownMenuTrigger>
            {menuOpen && (
              <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-[216px]">
                <DropdownMenuItem
                  className="gap-2 px-3"
                  onClick={e => handleMenuAction(e, () => openDeployDrawer({ instanceId: instance.id }))}
                >
                  <span className="system-sm-regular text-text-secondary">{t('card.menu.deploy')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 px-3"
                  onClick={e => handleMenuAction(e, navigateToDetail)}
                >
                  <span className="system-sm-regular text-text-secondary">{t('card.menu.viewDetail')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 px-3"
                  onClick={e => handleMenuAction(e, () => deleteInstance(instance.id))}
                >
                  <span className="system-sm-regular text-text-destructive">{t('card.menu.delete')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

type EnvironmentFilterOption = {
  value: string
  text: string
  icon: React.ReactNode
}

type EnvironmentFilterProps = {
  value: string
  options: EnvironmentFilterOption[]
  onChange: (value: string) => void
}

const EnvironmentFilter: FC<EnvironmentFilterProps> = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(option => option.value === value) ?? options[0]

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'flex h-8 cursor-pointer items-center gap-1 rounded-lg border-[0.5px] border-transparent bg-components-input-bg-normal px-2 text-left select-none',
          open && 'shadow-xs',
        )}
      >
        <div className="p-px text-text-tertiary">
          {selectedOption?.icon}
        </div>
        <div className="max-w-[160px] min-w-0 truncate text-[13px] leading-[18px] text-text-secondary">
          {selectedOption?.text}
        </div>
        <div className="shrink-0 p-px">
          <span className={cn('i-ri-arrow-down-s-line h-3.5 w-3.5 text-text-tertiary transition-transform', open && 'rotate-180')} />
        </div>
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent
          placement="bottom-start"
          sideOffset={4}
          popupClassName="w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg backdrop-blur-[5px]"
        >
          <div className="max-h-72 overflow-auto p-1">
            {options.map(option => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg py-[6px] pr-2 pl-3 select-none hover:bg-state-base-hover"
              >
                <span className="shrink-0 text-text-tertiary">{option.icon}</span>
                <span className="grow truncate text-sm leading-5 text-text-tertiary">{option.text}</span>
                {option.value === value && (
                  <span className="i-custom-vender-line-general-check h-4 w-4 shrink-0 text-text-secondary" />
                )}
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}

const DeploymentsMain: FC = () => {
  const { t } = useTranslation('deployments')
  const instances = useDeploymentsStore(state => state.instances)
  const environments = useDeploymentsStore(state => state.environments)
  const deployments = useDeploymentsStore(state => state.deployments)
  const openCreateInstanceModal = useDeploymentsStore(state => state.openCreateInstanceModal)

  const [envFilter, setEnvFilter] = useQueryState(
    'env',
    parseAsString.withDefault('all').withOptions({ history: 'push' }),
  )
  const [keywords, setKeywords] = useQueryState(
    'keywords',
    parseAsString.withDefault('').withOptions({ history: 'push' }),
  )
  const [keywordsInput, setKeywordsInput] = useState(keywords)

  const { run: commitKeywords } = useDebounceFn((next: string) => {
    void setKeywords(next.trim() ? next : null)
  }, { wait: 300 })

  const handleKeywordsChange = (next: string) => {
    setKeywordsInput(next)
    commitKeywords(next)
  }

  const { appMap } = useSourceApps()
  const deploymentsByInstance = useMemo(() => {
    const map = new Map<string, Deployment[]>()
    deployments.forEach((d) => {
      const list = map.get(d.instanceId) ?? []
      list.push(d)
      map.set(d.instanceId, list)
    })
    return map
  }, [deployments])

  const envIdSet = useMemo(() => new Set(environments.map(e => e.id)), [environments])
  const activeFilter = envFilter === 'all' || envFilter === 'not-deployed' || envIdSet.has(envFilter)
    ? envFilter
    : 'all'

  const filterOptions = useMemo(() => {
    return [
      {
        value: 'all',
        text: t('filter.allEnvs'),
        icon: <span className="i-ri-apps-2-line h-[14px] w-[14px]" />,
      },
      ...environments.map(env => ({
        value: env.id,
        text: env.name,
        icon: <span className="i-ri-stack-line h-[14px] w-[14px]" />,
      })),
      {
        value: 'not-deployed',
        text: t('filter.notDeployed'),
        icon: <span className="i-ri-inbox-line h-[14px] w-[14px]" />,
      },
    ]
  }, [environments, t])

  const visibleInstances = useMemo(() => {
    const byEnv = activeFilter === 'all'
      ? instances
      : activeFilter === 'not-deployed'
        ? instances.filter(i => (deploymentsByInstance.get(i.id)?.length ?? 0) === 0)
        : instances.filter(i => (deploymentsByInstance.get(i.id) ?? []).some(d => d.environmentId === activeFilter))

    const q = keywords.trim().toLowerCase()
    if (!q)
      return byEnv
    return byEnv.filter((i) => {
      const app = appMap.get(i.appId)
      return (
        i.name.toLowerCase().includes(q)
        || (i.description ?? '').toLowerCase().includes(q)
        || (app?.name.toLowerCase().includes(q) ?? false)
      )
    })
  }, [instances, deploymentsByInstance, activeFilter, keywords, appMap])

  return (
    <>
      <div className="relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body">
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-y-2 bg-background-body px-12 pt-7 pb-5">
          <div className="flex items-center gap-2">
            <EnvironmentFilter
              value={activeFilter}
              onChange={(next) => { void setEnvFilter(next) }}
              options={filterOptions}
            />
            <Input
              showLeftIcon
              showClearIcon
              wrapperClassName="w-[200px]"
              placeholder={t('filter.searchPlaceholder')}
              value={keywordsInput}
              onChange={e => handleKeywordsChange(e.target.value)}
              onClear={() => handleKeywordsChange('')}
            />
          </div>
        </div>
        <div className="relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 2k:grid-cols-6 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          <NewInstanceCard onOpen={openCreateInstanceModal} />
          {visibleInstances.map((instance) => {
            const app = appMap.get(instance.appId)
            if (!app)
              return null
            return (
              <InstanceCard
                key={instance.id}
                instance={instance}
                app={app}
                deployments={deploymentsByInstance.get(instance.id) ?? []}
                environments={environments}
              />
            )
          })}
        </div>

        <div className="py-4" />
      </div>

      <CreateInstanceModal />
      <DeployDrawer />
      <RollbackModal />
    </>
  )
}

export default DeploymentsMain
