'use client'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useWorkspacePermissions } from '@/service/use-workspace'

type Props = {
  onOperate: () => void
}

const TransferOwnership = ({ onOperate }: Props) => {
  const { t } = useTranslation()
  const { currentWorkspace } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: workspacePermissions, isFetching: isFetchingWorkspacePermissions } = useWorkspacePermissions(currentWorkspace!.id, systemFeatures.branding.enabled)
  if (systemFeatures.branding.enabled) {
    if (isFetchingWorkspacePermissions) {
      return <Loading />
    }
    if (!workspacePermissions || workspacePermissions.allow_owner_transfer !== true) {
      return <span className="px-3 system-sm-regular text-text-secondary">{t('members.owner', { ns: 'common' })}</span>
    }
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          'group flex h-full w-full cursor-pointer items-center justify-between px-3 system-sm-regular text-text-secondary outline-hidden',
          'hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover data-popup-open:bg-state-base-hover',
        )}
      >
        {t('members.owner', { ns: 'common' })}
        <RiArrowDownSLine className="hidden h-4 w-4 group-hover:block group-data-popup-open:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        popupClassName="bg-components-panel-bg-blur p-1 backdrop-blur-xs"
      >
        <DropdownMenuItem
          className="h-auto px-3 py-2"
          onClick={onOperate}
        >
          <span className="system-md-regular whitespace-nowrap text-text-secondary">{t('members.transferOwnership', { ns: 'common' })}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default TransferOwnership
