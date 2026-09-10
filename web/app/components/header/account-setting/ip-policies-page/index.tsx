'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getNetworkAccessErrorStatus } from '@/app/components/app/access-point/access-control/network-access'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import { consoleQuery } from '@/service/console'
import { IpPolicyDialog } from './policy-dialog'
import { PolicyItem } from './policy-item'

type DialogState = { mode: 'create' } | { mode: 'edit'; group: NetworkAccessGroupResponse } | null

function IpPoliciesListSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t(($) => $.loading, { ns: 'common' })} className="space-y-2">
      {Array.from({ length: 2 }, (_, index) => (
        <div
          key={index}
          className="rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg p-4 shadow-xs"
        >
          <SkeletonContainer className="h-14">
            <SkeletonRow>
              <div className="flex flex-1 flex-col gap-1">
                <SkeletonRectangle className="h-4 w-1/3 animate-pulse" />
                <SkeletonRectangle className="h-3 w-1/2 animate-pulse" />
              </div>
            </SkeletonRow>
          </SkeletonContainer>
        </div>
      ))}
    </div>
  )
}

export default function IpPoliciesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [_pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const groupsQuery = consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions({
    retry: false,
  })
  const { data, isPending, isError } = useQuery(groupsQuery)
  const createGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.post.mutationOptions(),
  )
  const updateGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.byGroupId.put.mutationOptions(),
  )
  const [dialogState, setDialogState] = useState<DialogState>(null)
  const groups = data?.groups ?? []
  const entitled = data?.entitled === true
  const editingGroup = dialogState?.mode === 'edit' ? dialogState.group : null
  const isSaving = createGroup.isPending || updateGroup.isPending

  const refreshGroupsAfterConflict = async (groupId?: string) => {
    const refreshed = await queryClient.fetchQuery(groupsQuery)
    if (!groupId) return
    const nextGroup = refreshed.groups.find((group) => group.id === groupId)
    setDialogState(nextGroup ? { mode: 'edit', group: nextGroup } : null)
  }

  const handleOpenCreate = () => {
    if (isError) return
    if (!entitled) {
      void setPricing('open')
      return
    }
    setDialogState({ mode: 'create' })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['settings.ipPolicies'], { ns: 'common' })}
          </h2>
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['settings.ipPoliciesDescription'], { ns: 'common' })}
          </p>
        </div>
        <Button variant="primary" size="small" onClick={handleOpenCreate}>
          {t(($) => $['settings.ipPolicyAddEntry'], { ns: 'common' })}
        </Button>
      </div>

      {isPending && <IpPoliciesListSkeleton />}
      {!isPending && isError && (
        <p className="py-10 text-center system-sm-regular text-text-tertiary">
          {t(($) => $['common.loadFailed'], { ns: 'deployments' })}
        </p>
      )}

      {!isPending && !isError && groups.length === 0 && (
        <div className="flex flex-col items-center gap-1 py-10 text-center">
          <p className="system-sm-medium text-text-secondary">
            {t(($) => $['studio.accessControl.emptyPoliciesTitle'], { ns: 'deployments' })}
          </p>
          <p className="max-w-md system-xs-regular text-text-tertiary">
            {t(($) => $['studio.accessControl.emptyPoliciesDescription'], { ns: 'deployments' })}
          </p>
        </div>
      )}

      {!isPending && groups.length > 0 && (
        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <PolicyItem
              key={group.id}
              group={group}
              canMutate={entitled}
              onEdit={(nextGroup) => setDialogState({ mode: 'edit', group: nextGroup })}
            />
          ))}
        </div>
      )}

      {dialogState && (
        <IpPolicyDialog
          mode={dialogState.mode}
          open
          initialName={editingGroup?.name}
          initialEntries={editingGroup?.allowed_cidrs}
          usedByCount={editingGroup?.used_by_count}
          referencedApps={editingGroup?.apps}
          isPending={isSaving}
          onOpenChange={(open) => {
            if (!open) setDialogState(null)
          }}
          onSubmit={(payload) => {
            if (editingGroup) {
              updateGroup.mutate(
                {
                  params: { group_id: editingGroup.id },
                  body: {
                    name: payload.name,
                    description: editingGroup.description ?? '',
                    allowed_cidrs: payload.allowed_cidrs,
                    expected_version: editingGroup.version,
                  },
                },
                {
                  onSuccess: () => setDialogState(null),
                  onError: (error) => {
                    if (getNetworkAccessErrorStatus(error) !== 409) return
                    void refreshGroupsAfterConflict(editingGroup.id)
                  },
                },
              )
              return
            }

            createGroup.mutate(
              {
                body: {
                  name: payload.name,
                  description: '',
                  allowed_cidrs: payload.allowed_cidrs,
                },
              },
              {
                onSuccess: () => setDialogState(null),
              },
            )
          }}
        />
      )}
    </div>
  )
}
