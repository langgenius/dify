import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import PremiumBadge from '@/app/components/base/premium-badge'
import { useStore } from '@/app/components/workflow/store'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { VersionHistoryContextMenuOptions } from '../../../types'

type ActionMenuProps = {
  workflowId: string
  isShowDelete: boolean
  isNamedVersion: boolean
  canImportExportDSL: boolean
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  handleClickActionMenuItem: (operation: VersionHistoryContextMenuOptions) => void
}

const useActionMenu = (props: ActionMenuProps) => {
  const { workflowId, isNamedVersion, canImportExportDSL } = props
  const { t } = useTranslation(['app', 'common', 'workflow', 'workflowHistory'])
  const pipelineId = useStore((s) => s.pipelineId)
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: plan } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.billing.subscription.plan,
    }),
  )
  const shouldShowUpgrade = deploymentEdition === 'CLOUD' && plan === 'sandbox'

  const deleteOperation = {
    key: VersionHistoryContextMenuOptions.delete,
    name: t(($) => $['operation.delete'], { ns: 'common' }),
  }

  const options = useMemo(() => {
    return [
      {
        key: VersionHistoryContextMenuOptions.restore,
        name: t(($) => $['common.restore'], { ns: 'workflow' }),
        disabled: deploymentEdition === 'CLOUD' && plan === undefined,
        ...(shouldShowUpgrade ? { showUpgrade: true } : {}),
      },
      isNamedVersion
        ? {
            key: VersionHistoryContextMenuOptions.edit,
            name: t(($) => $['versionHistory.editVersionInfo'], { ns: 'workflowHistory' }),
          }
        : {
            key: VersionHistoryContextMenuOptions.edit,
            name: t(($) => $['versionHistory.nameThisVersion'], { ns: 'workflowHistory' }),
          },
      // todo: pipeline support export specific version DSL
      ...(canImportExportDSL && !pipelineId
        ? [
            {
              key: VersionHistoryContextMenuOptions.exportDSL,
              name: t(($) => $.exportApp, { ns: 'app' }),
              disabled: deploymentEdition === 'CLOUD' && plan === undefined,
              ...(shouldShowUpgrade ? { showUpgrade: true } : {}),
            },
          ]
        : []),
      {
        key: VersionHistoryContextMenuOptions.copyId,
        name: t(($) => $['versionHistory.copyId'], { ns: 'workflowHistory' }),
        description: workflowId,
      },
    ]
  }, [
    deploymentEdition,
    plan,
    canImportExportDSL,
    isNamedVersion,
    pipelineId,
    shouldShowUpgrade,
    t,
    workflowId,
  ])

  return {
    deleteOperation,
    options,
  }
}

type ActionMenuItemProps = {
  item: {
    key: VersionHistoryContextMenuOptions
    name: string
    description?: string
    disabled?: boolean
    showUpgrade?: boolean
  }
  onClick: (operation: VersionHistoryContextMenuOptions) => void
  isDestructive?: boolean
}

function ActionMenuItem({ item, onClick, isDestructive = false }: ActionMenuItemProps) {
  const { t } = useTranslation(['billing'])
  return (
    <DropdownMenuItem
      disabled={item.disabled}
      variant={isDestructive ? 'destructive' : 'default'}
      className={cn(
        'justify-between gap-x-3 py-1.5 whitespace-nowrap',
        item.description && 'h-auto py-1',
      )}
      onClick={(event) => {
        event.stopPropagation()
        onClick(item.key)
        if (item.showUpgrade) {
          const gtag = (
            window as Window & {
              gtag?: (
                command: 'event',
                action: 'click_upgrade_btn',
                payload: { loc: string },
              ) => void
            }
          ).gtag
          gtag?.('event', 'click_upgrade_btn', { loc: 'workflow-version-history-menu' })
        }
      }}
    >
      <div
        className={cn(
          'min-w-0 flex-1 px-1 py-0.5 system-md-regular whitespace-nowrap text-text-primary',
          item.description && 'flex flex-col gap-y-0.5 text-text-secondary',
          isDestructive && 'text-inherit',
        )}
      >
        <div className="w-full truncate">{item.name}</div>
        {item.description && (
          <div
            className="w-full max-w-38 truncate system-2xs-regular text-text-tertiary"
            title={item.description}
          >
            {item.description}
          </div>
        )}
      </div>
      {item.showUpgrade && (
        <PremiumBadge
          size="custom"
          color="blue"
          allowHover
          className="h-5! shrink-0 rounded-md! px-1!"
        >
          <span
            aria-hidden
            className="i-custom-public-common-sparkles-soft flex size-3.5 items-center bg-clip-content bg-origin-content mask-clip-content mask-origin-content py-px pl-0.75 text-components-premium-badge-indigo-text-stop-0"
          />
          <span className="p-1 system-xs-medium">
            {t(($) => $['upgradeBtn.encourageShort'], { ns: 'billing' })}
          </span>
        </PremiumBadge>
      )}
    </DropdownMenuItem>
  )
}

function ActionMenu(props: ActionMenuProps) {
  const { isShowDelete, handleClickActionMenuItem, open, setOpen } = props
  const { deleteOperation, options } = useActionMenu(props)
  const { t } = useTranslation(['common'])
  const triggerRef = useRef<HTMLButtonElement>(null)

  function handleAction(operation: VersionHistoryContextMenuOptions) {
    queueMicrotask(() => {
      triggerRef.current?.focus()
      handleClickActionMenuItem(operation)
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        ref={triggerRef}
        className="absolute top-1 right-1 z-10 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus:opacity-100 data-popup-open:opacity-100 [@media(hover:none)]:opacity-100"
        render={
          <IconButton
            size="md"
            variant="secondary"
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            onClick={(e) => e.stopPropagation()}
          >
            <span aria-hidden className="i-ri-more-fill size-4" />
          </IconButton>
        }
      />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        className="w-max max-w-[calc(100vw-24px)] min-w-46 shadow-shadow-shadow-5"
      >
        {options.map((option) => (
          <ActionMenuItem key={option.key} item={option} onClick={handleAction} />
        ))}
        {isShowDelete && (
          <>
            <DropdownMenuSeparator />
            <ActionMenuItem item={deleteOperation} isDestructive onClick={handleAction} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default React.memo(ActionMenu)
