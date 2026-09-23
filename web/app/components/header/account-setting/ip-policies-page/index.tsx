'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getNetworkAccessErrorStatus } from '@/app/components/app/access-point/access-control/network-access'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import {
  canManageNetworkAccessPoliciesAtom,
  canReadNetworkAccessAtom,
} from '@/features/network-access/permissions'
import { consoleQuery } from '@/service/console'
import { IpPolicyDialog } from './policy-dialog'
import {
  policyActionsColClassName,
  policyIpEntriesColClassName,
  PolicyItem,
  policyNameColClassName,
  policyRowClassName,
  policyUpdatedColClassName,
  policyUsedByColClassName,
} from './policy-item'

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit' | 'view'; group: NetworkAccessGroupResponse }
  | null

function IpPoliciesListSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-label={t(($) => $.loading, { ns: 'common' })}>
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className={`${policyRowClassName} border-b border-divider-subtle py-3`}>
          <SkeletonContainer className="h-4 min-w-0 flex-1">
            <SkeletonRow>
              <SkeletonRectangle className="h-4 w-1/2 animate-pulse" />
            </SkeletonRow>
          </SkeletonContainer>
          <SkeletonRectangle className={`${policyIpEntriesColClassName} h-4 animate-pulse`} />
          <SkeletonRectangle className={`${policyUsedByColClassName} h-4 animate-pulse`} />
          <SkeletonRectangle className={`${policyUpdatedColClassName} h-4 animate-pulse`} />
          <div className={policyActionsColClassName} />
        </div>
      ))}
    </div>
  )
}

export default function IpPoliciesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const canReadPolicies = useAtomValue(canReadNetworkAccessAtom)
  const canManagePolicies = useAtomValue(canManageNetworkAccessPoliciesAtom)
  const [_pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const groupsQuery = consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions({
    enabled: canReadPolicies,
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
  const dialogSessionRef = useRef(0)
  const [isRecovering, setIsRecovering] = useState(false)
  const [recoveryError, setRecoveryError] = useState(false)
  const groups = data?.groups ?? []
  const entitled = data?.entitled === true
  const canMutate = canManagePolicies && entitled
  const selectedGroup = dialogState && dialogState.mode !== 'create' ? dialogState.group : null
  const isSaving = createGroup.isPending || updateGroup.isPending

  const openDialog = (next: DialogState) => {
    dialogSessionRef.current += 1
    setIsRecovering(false)
    setRecoveryError(false)
    setDialogState(next)
  }

  const refreshGroupsAfterConflict = async (groupId: string, session: number) => {
    if (dialogSessionRef.current !== session) return
    setIsRecovering(true)
    setRecoveryError(false)
    try {
      const refreshed = await queryClient.query({ ...groupsQuery, staleTime: 0 })
      if (dialogSessionRef.current !== session) return
      const nextGroup = refreshed.groups.find((group) => group.id === groupId)
      setDialogState((current) =>
        current?.mode === 'edit' && current.group.id === groupId
          ? nextGroup
            ? { mode: 'edit', group: nextGroup }
            : null
          : current,
      )
    } catch {
      if (dialogSessionRef.current === session) setRecoveryError(true)
    } finally {
      if (dialogSessionRef.current === session) setIsRecovering(false)
    }
  }

  const handleOpenCreate = () => {
    if (!canManagePolicies || isPending || isError) return
    if (!entitled) {
      void setPricing('open')
      return
    }
    openDialog({ mode: 'create' })
  }

  if (!canReadPolicies) return null

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
        {canManagePolicies && (
          <Button variant="primary" size="small" onClick={handleOpenCreate}>
            <span aria-hidden className="i-ri-add-line size-4" />
            {t(($) => $['settings.ipPolicyAddEntry'], { ns: 'common' })}
          </Button>
        )}
      </div>

      {isPending && <IpPoliciesListSkeleton />}
      {!isPending && isError && (
        <p className="py-10 text-center system-sm-regular text-text-tertiary">
          {t(($) => $['common.loadFailed'], { ns: 'deployments' })}
        </p>
      )}

      {!isPending && !isError && groups.length === 0 && (
        <div className="flex flex-col items-center py-10 text-center">
          <p className="system-sm-medium text-text-secondary">
            {t(($) => $['studio.accessControl.emptyPoliciesTitle'], { ns: 'deployments' })}
          </p>
        </div>
      )}

      {!isPending && groups.length > 0 && (
        <div className="min-w-0">
          <div
            className={`${policyRowClassName} border-b border-divider-subtle py-2 system-xs-medium-uppercase text-text-tertiary`}
          >
            <div className={policyNameColClassName}>
              {t(($) => $['settings.ipPolicyColumnName'], { ns: 'common' })}
            </div>
            <div className={policyIpEntriesColClassName}>
              {t(($) => $['settings.ipPolicyColumnIpEntries'], { ns: 'common' })}
            </div>
            <div className={policyUsedByColClassName}>
              {t(($) => $['settings.ipPolicyColumnUsedBy'], { ns: 'common' })}
            </div>
            <div className={policyUpdatedColClassName}>
              {t(($) => $['settings.ipPolicyColumnUpdatedAt'], { ns: 'common' })}
            </div>
            <div className={policyActionsColClassName} />
          </div>
          {groups.map((group) => (
            <PolicyItem
              key={group.id}
              group={group}
              canMutate={canMutate}
              onView={(group) => openDialog({ mode: canMutate ? 'edit' : 'view', group })}
              onEdit={(group) => {
                if (!canMutate) return
                openDialog({ mode: 'edit', group })
              }}
            />
          ))}
        </div>
      )}

      {dialogState && (dialogState.mode !== 'create' || canMutate) && (
        <IpPolicyDialog
          key={selectedGroup ? `${selectedGroup.id}:${selectedGroup.version}` : 'create'}
          mode={canMutate ? dialogState.mode : 'view'}
          open
          initialName={selectedGroup?.name}
          initialEntries={selectedGroup?.allowed_cidrs}
          usedByCount={selectedGroup?.used_by_count}
          referencedApps={selectedGroup?.apps}
          isPending={isSaving || isRecovering}
          recoveryError={recoveryError}
          onRetryRecovery={() => {
            if (selectedGroup)
              void refreshGroupsAfterConflict(selectedGroup.id, dialogSessionRef.current)
          }}
          onOpenChange={(open) => {
            if (!open) openDialog(null)
          }}
          onSubmit={(payload) => {
            if (
              !canMutate ||
              isSaving ||
              isRecovering ||
              recoveryError ||
              dialogState.mode === 'view'
            )
              return
            const session = dialogSessionRef.current
            if (selectedGroup) {
              updateGroup.mutate(
                {
                  params: { group_id: selectedGroup.id },
                  body: {
                    name: payload.name,
                    description: selectedGroup.description ?? '',
                    allowed_cidrs: payload.allowed_cidrs,
                    expected_version: selectedGroup.version,
                  },
                },
                {
                  onSuccess: () => {
                    if (dialogSessionRef.current === session) openDialog(null)
                  },
                  onError: (error) => {
                    if (getNetworkAccessErrorStatus(error) !== 409) return
                    void refreshGroupsAfterConflict(selectedGroup.id, session)
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
                onSuccess: () => {
                  if (dialogSessionRef.current === session) openDialog(null)
                },
              },
            )
          }}
        />
      )}
    </div>
  )
}
