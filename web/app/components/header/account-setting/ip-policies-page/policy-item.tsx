'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AppIconType } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { consoleQuery } from '@/service/console'
import { PolicyReferencedApps } from './referenced-apps'
import { splitPolicySummary } from './validate-ip-entry'

function toAppIconType(iconType: string | null | undefined): AppIconType | undefined {
  if (iconType === 'image' || iconType === 'emoji' || iconType === 'link') return iconType
}

type PolicyItemProps = {
  group: NetworkAccessGroupResponse
  canMutate: boolean
  onEdit: (group: NetworkAccessGroupResponse) => void
}

export function PolicyItem({ group, canMutate, onEdit }: PolicyItemProps) {
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const deleteGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.byGroupId.delete.mutationOptions(),
  )
  const summary = splitPolicySummary(group.allowed_cidrs)
  const isBound = group.used_by_count > 0
  const usedByNames = group.apps.map((app) => app.name).filter(Boolean)

  const handleDelete = () => {
    if (!canMutate) return

    deleteGroup.mutate(
      {
        params: { group_id: group.id },
        query: { expected_version: group.version },
      },
      {
        onSuccess: () => {
          setConfirmDelete(false)
        },
      },
    )
  }

  return (
    <div className="group flex items-center rounded-xl border-[0.5px] border-transparent bg-components-input-bg-normal px-4 py-3 focus-within:border-components-input-border-active focus-within:shadow-xs hover:border-components-input-border-active hover:shadow-xs">
      <div className="min-w-0 flex-1">
        <p className="truncate system-sm-medium text-text-secondary">{group.name}</p>
        <p className="truncate system-xs-regular text-text-tertiary">
          {summary.listed.length === 0
            ? t(($) => $['studio.accessControl.policySummaryNone'], { ns: 'deployments' })
            : summary.listed.length === 1
              ? t(($) => $['studio.accessControl.policySummaryOne'], {
                  ns: 'deployments',
                  address: summary.listed[0],
                })
              : summary.moreCount > 0
                ? t(($) => $['studio.accessControl.policySummaryMany'], {
                    ns: 'deployments',
                    listed: summary.listed.join(', '),
                    count: summary.moreCount,
                  })
                : t(($) => $['studio.accessControl.policySummaryTwo'], {
                    ns: 'deployments',
                    first: summary.listed[0],
                    second: summary.listed[1],
                  })}
        </p>
        {isBound && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
            <div className="flex items-center -space-x-1">
              {group.apps.slice(0, 3).map((app) => (
                <AppIcon
                  key={app.id}
                  size="xs"
                  decorative
                  iconType={toAppIconType(app.icon_type)}
                  icon={app.icon ?? undefined}
                  background={app.icon_background}
                  className="rounded-sm ring-1 ring-components-panel-bg"
                />
              ))}
            </div>
            <p className="min-w-0 truncate system-xs-regular text-text-tertiary">
              {usedByNames.length > 0
                ? usedByNames.join(', ')
                : t(($) => $['settings.ipPolicyUsedBy'], {
                    ns: 'common',
                    count: group.used_by_count,
                  })}
            </p>
          </div>
        )}
      </div>
      <div className="pointer-events-none flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Button disabled={!canMutate} onClick={() => canMutate && onEdit(group)}>
          <span className="i-ri-edit-line size-4" aria-hidden="true" />
          {t(($) => $['operation.edit'], { ns: 'common' })}
        </Button>
        <Button disabled={!canMutate} onClick={() => canMutate && setConfirmDelete(true)}>
          <span className="i-ri-delete-bin-line size-4" aria-hidden="true" />
          {t(($) => $['operation.delete'], { ns: 'common' })}
        </Button>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent backdropProps={{ forceRender: true }} className="w-100">
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="title-xl-semi-bold text-text-primary">
              {t(($) => $['settings.ipPolicyDeleteConfirm'], { ns: 'common', name: group.name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-secondary">
              {isBound
                ? t(($) => $['settings.ipPolicyDeleteBoundDescription'], {
                    ns: 'common',
                    name: group.name,
                    count: group.used_by_count,
                  })
                : t(($) => $['settings.ipPolicyDeleteDescription'], { ns: 'common' })}
            </AlertDialogDescription>
            {isBound && (
              <PolicyReferencedApps apps={group.apps} usedByCount={group.used_by_count} />
            )}
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary">
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={!canMutate || deleteGroup.isPending}
              onClick={handleDelete}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
