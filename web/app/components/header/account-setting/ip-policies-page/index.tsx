'use client'

import type { NetworkAccessGroupResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { DialogChangeEventDetails } from '@langgenius/dify-ui/dialog'
import type { DeletePolicyPayload, PolicyDialogPayload } from './policy-dialog-payload'
import type { IpPolicyFormContext } from '@/features/network-access/analytics'
import type { IpPolicyDialogSubmit } from '@/features/network-access/policy-editor'
import type { IpPolicyFormSession } from '@/features/network-access/policy-editor/policy-form-analytics'
import { createAlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { createDialogHandle, Dialog, DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { isDefinedError } from '@orpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { Suspense, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonContainer, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import {
  pricingQueryParamName,
  pricingQueryParser,
} from '@/app/components/billing/pricing/query-params'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { getIpPolicyFailReason, trackNetworkAccessEvent } from '@/features/network-access/analytics'
import {
  canManageNetworkAccessPoliciesAtom,
  canReadNetworkAccessAtom,
} from '@/features/network-access/permissions'
import { IpPolicyDialogContent, IpPolicyForm } from '@/features/network-access/policy-editor'
import {
  recordPolicyValidation,
  startIpPolicyForm,
} from '@/features/network-access/policy-editor/policy-form-analytics'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { DeletePolicyDialog } from './delete-policy-dialog'
import {
  policyActionsColClassName,
  policyIpEntriesColClassName,
  PolicyItem,
  policyNameColClassName,
  policyRowClassName,
  policyUpdatedColClassName,
  policyUsedByColClassName,
} from './policy-item'

type PolicyRecovery = {
  group?: NetworkAccessGroupResponse
  status: 'loading' | 'failed' | 'ready'
}

type EditPolicySessionProps = {
  request: PolicyDialogPayload
  recovery?: PolicyRecovery
  canMutate: boolean
  isSaving: boolean
  onRetry: (groupId: string) => void
  onValidateEntries: (entries: readonly string[]) => void
  onSubmit: (group: NetworkAccessGroupResponse, input: IpPolicyDialogSubmit) => void
}

function EditPolicySession({
  request,
  recovery,
  canMutate,
  isSaving,
  onRetry,
  onValidateEntries,
  onSubmit,
}: EditPolicySessionProps) {
  // List refetches can update a detached trigger's payload while the form is open.
  const [initialRequest] = useState(request)
  const group = recovery?.group ?? initialRequest.group
  return (
    <IpPolicyForm
      key={group.version}
      mode={canMutate ? initialRequest.mode : 'view'}
      initialName={group.name}
      initialEntries={group.allowed_cidrs}
      usedByCount={group.used_by_count}
      referencedApps={group.apps}
      isPending={isSaving || recovery?.status === 'loading'}
      dismissDisabled={isSaving}
      recoveryError={recovery?.status === 'failed'}
      onRetryRecovery={() => onRetry(group.id)}
      onValidateEntries={onValidateEntries}
      onSubmit={(input) => onSubmit(group, input)}
    />
  )
}

function IpPoliciesListSkeleton() {
  const { t } = useTranslation(['common'])

  return (
    <div role="progressbar" aria-label={t(($) => $.loading, { ns: 'common' })}>
      {Array.from({ length: 2 }, (_, index) => (
        <div key={index} className={`${policyRowClassName} border-b border-divider-subtle py-3`}>
          <SkeletonContainer className="h-4 min-w-0 flex-1">
            <SkeletonRow>
              <SkeletonRectangle className="h-4 w-1/2 motion-safe:animate-pulse" />
            </SkeletonRow>
          </SkeletonContainer>
          <SkeletonRectangle
            className={`${policyIpEntriesColClassName} h-4 motion-safe:animate-pulse`}
          />
          <SkeletonRectangle
            className={`${policyUsedByColClassName} h-4 motion-safe:animate-pulse`}
          />
          <SkeletonRectangle
            className={`${policyUpdatedColClassName} h-4 motion-safe:animate-pulse`}
          />
          <div className={policyActionsColClassName} />
        </div>
      ))}
    </div>
  )
}

function IpPoliciesStatusMessage({ reason }: { reason: 'error' | 'read-only' }) {
  const { t } = useTranslation(['deployments'])

  return reason === 'error'
    ? t(($) => $['common.loadFailed'], { ns: 'deployments' })
    : t(($) => $['studio.accessControl.emptyPoliciesReadOnly'], { ns: 'deployments' })
}

export default function IpPoliciesPage() {
  const { t } = useTranslation(['common'])
  const titleId = useId()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const queryClient = useQueryClient()
  const { plan } = useAtomValue(currentWorkspaceAtom)
  const canReadPolicies = useAtomValue(canReadNetworkAccessAtom)
  const canManagePolicies = useAtomValue(canManageNetworkAccessPoliciesAtom)
  const [_pricing, setPricing] = useQueryState(pricingQueryParamName, pricingQueryParser)
  const groupsQuery = consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions({
    enabled: canReadPolicies,
    retry: false,
  })
  const groupsResult = useQuery(groupsQuery)
  const { data, isPending } = groupsResult
  // A failed first load replaces the list; a failed refetch keeps it and the cache reports it.
  // The page renders nothing without read access.
  const groupsLoad = useOwnedQueryError(groupsResult, canReadPolicies)
  // Fail offline saves instead of queueing a write behind a locked dialog.
  const createGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.post.mutationOptions({
      networkMode: 'always',
    }),
  )
  const updateGroup = useMutation(
    consoleQuery.workspaces.current.networkAccessGroups.byGroupId.put.mutationOptions({
      networkMode: 'always',
    }),
  )
  const [createDialog] = useState(() => createDialogHandle())
  const [deleteDialog] = useState(() => createAlertDialogHandle<DeletePolicyPayload>())
  const [policyDialog] = useState(() => createDialogHandle<PolicyDialogPayload>())
  const [recovery, setRecovery] = useState<PolicyRecovery>()
  const createButtonRef = useRef<HTMLButtonElement>(null)
  const formAnalyticsRef = useRef<IpPolicyFormSession | null>(null)
  const groups = data?.groups ?? []
  const isEmpty = !isPending && !groupsLoad && groups.length === 0
  const entitled = data?.entitled === true
  const canMutate = canManagePolicies && entitled
  const isSaving = createGroup.isPending || updateGroup.isPending
  const viewedRef = useRef(false)
  useEffect(() => {
    if (!canReadPolicies || viewedRef.current) return
    viewedRef.current = true
    trackNetworkAccessEvent('ip_policy_interaction', { action: 'settings_tab_viewed' })
  }, [canReadPolicies])

  const refreshGroupsAfterConflict = async (groupId: string, session: IpPolicyFormSession) => {
    if (formAnalyticsRef.current !== session) return
    setRecovery((current) => ({ ...current, status: 'loading' }))
    try {
      const refreshed = await queryClient.query(
        consoleQuery.workspaces.current.networkAccessGroups.get.queryOptions({
          staleTime: 0,
          retry: false,
        }),
      )
      if (formAnalyticsRef.current !== session) return
      const nextGroup = refreshed.groups.find((group) => group.id === groupId)
      if (nextGroup) setRecovery({ group: nextGroup, status: 'ready' })
      else policyDialog.close()
    } catch {
      if (formAnalyticsRef.current === session)
        setRecovery((current) => ({ ...current, status: 'failed' }))
    }
  }

  const handleFormOpen = (context: IpPolicyFormContext) => {
    formAnalyticsRef.current = startIpPolicyForm(context)
  }

  const handleValidateEntries = (entries: readonly string[]) => {
    if (formAnalyticsRef.current) recordPolicyValidation(formAnalyticsRef.current, entries)
  }

  const handleDialogOpenChange = (
    open: boolean,
    details: DialogChangeEventDetails,
    isSubmitting: boolean,
  ) => {
    if (!open && isSubmitting && details.reason !== 'imperative-action') {
      details.cancel()
      return
    }
    if (open) setRecovery(undefined)
    else formAnalyticsRef.current = null
  }

  const renderCreateButton = (source: 'list_add_button' | 'list_empty_state') => {
    const isEmptyAction = source === 'list_empty_state'
    const content = (
      <>
        <span aria-hidden className="i-ri-add-line size-4" />
        {isEmptyAction
          ? t(($) => $['settings.ipPolicyEmptyCreate'], { ns: 'common' })
          : t(($) => $['settings.ipPolicyAddEntry'], { ns: 'common' })}
      </>
    )
    const size = isEmptyAction ? undefined : 'small'
    if (!entitled) {
      return (
        <Button
          variant="primary"
          size={size}
          onClick={() => {
            void setPricing('open')
          }}
        >
          {content}
        </Button>
      )
    }
    return (
      <DialogTrigger
        handle={createDialog}
        onClick={() => handleFormOpen({ mode: 'create', source })}
        render={<Button variant="primary" size={size} ref={createButtonRef} />}
      >
        {content}
      </DialogTrigger>
    )
  }

  const submitPolicy = (
    selectedGroup: NetworkAccessGroupResponse | null,
    payload: IpPolicyDialogSubmit,
  ) => {
    const formSession = formAnalyticsRef.current
    if (!formSession || !canMutate || isSaving || (recovery && recovery.status !== 'ready')) return
    const { mode } = formSession.context
    const dialog = selectedGroup ? policyDialog : createDialog
    if (!dialog.isOpen || mode === 'view') return
    const analytics = {
      ...formSession.context,
      mode,
      entry_count: payload.allowed_cidrs.length,
      validation_error_types: [...formSession.validationErrors],
    }
    const trackFailure = (error: unknown) => {
      trackNetworkAccessEvent('ip_policy_save', {
        ...analytics,
        result: 'failed',
        fail_reason: getIpPolicyFailReason(error),
      })
    }
    if (selectedGroup) {
      void updateGroup
        .mutateAsync(
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
              if (formAnalyticsRef.current === formSession && dialog.isOpen) dialog.close()
            },
            onError: (error) => {
              if (!isDefinedError(error) || error.code !== 'network_access_version_conflict') return
              void refreshGroupsAfterConflict(selectedGroup.id, formSession)
            },
          },
        )
        .then(
          (data) =>
            trackNetworkAccessEvent('ip_policy_save', {
              ...analytics,
              result: 'success',
              policy_id: data.group.id,
            }),
          trackFailure,
        )
      return
    }

    void createGroup
      .mutateAsync(
        {
          body: {
            name: payload.name,
            description: '',
            allowed_cidrs: payload.allowed_cidrs,
          },
        },
        {
          onSuccess: () => {
            if (formAnalyticsRef.current === formSession && dialog.isOpen) dialog.close()
          },
        },
      )
      .then(
        (data) =>
          trackNetworkAccessEvent('ip_policy_save', {
            ...analytics,
            result: 'success',
            policy_id: data.group.id,
          }),
        trackFailure,
      )
  }

  if (!canReadPolicies) return null

  return (
    <div className="@container flex flex-col gap-4">
      <div className="flex min-h-15 items-start justify-between gap-4 py-2 @max-[480px]:flex-col">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            ref={titleRef}
            tabIndex={-1}
            id={titleId}
            className="title-2xl-semi-bold text-text-primary"
          >
            {t(($) => $['settings.ipPolicies'], { ns: 'common' })}
          </h2>
          <p className="system-sm-regular text-text-tertiary">
            {t(($) => $['settings.ipPoliciesDescription'], { ns: 'common' })}
          </p>
          {plan === 'sandbox' && (
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['settings.ipPoliciesProPlanRequired'], { ns: 'common' })}
            </p>
          )}
        </div>
        {canManagePolicies &&
          !isPending &&
          groups.length > 0 &&
          renderCreateButton('list_add_button')}
      </div>

      {isPending && <IpPoliciesListSkeleton />}
      {groupsLoad && (
        <p className="py-10 text-center system-sm-regular text-text-tertiary">
          <Suspense fallback={null}>
            <IpPoliciesStatusMessage reason="error" />
          </Suspense>
        </p>
      )}

      {isEmpty && (
        <div className="flex min-h-100 flex-col items-center justify-center gap-4 py-6 text-center">
          <img src="/illustrations/ip-policies-empty.svg" alt="" width={48} height={48} />
          <div className="flex w-full max-w-105 flex-col gap-2">
            <h3 className="title-xl-semi-bold leading-6 text-text-primary">
              {t(($) => $['settings.ipPolicyEmptyTitle'], { ns: 'common' })}
            </h3>
            <p className="system-sm-regular leading-5 whitespace-pre-line text-text-tertiary">
              {canManagePolicies ? (
                t(($) => $['settings.ipPolicyEmptyDescription'], { ns: 'common' })
              ) : (
                <Suspense fallback={null}>
                  <IpPoliciesStatusMessage reason="read-only" />
                </Suspense>
              )}
            </p>
          </div>
          {canManagePolicies && renderCreateButton('list_empty_state')}
        </div>
      )}

      {!isPending && groups.length > 0 && (
        <ScrollArea className="min-w-0">
          <ScrollAreaViewport
            role="region"
            aria-labelledby={titleId}
            style={{ overflowY: 'hidden' }}
          >
            <ScrollAreaContent style={{ minWidth: 0 }}>
              <div role="table" aria-labelledby={titleId} className="w-full min-w-160">
                <div
                  role="row"
                  className={`${policyRowClassName} border-b border-divider-subtle py-2 system-xs-medium-uppercase text-text-tertiary`}
                >
                  <div role="columnheader" className={policyNameColClassName}>
                    {t(($) => $['settings.ipPolicyColumnName'], { ns: 'common' })}
                  </div>
                  <div role="columnheader" className={policyIpEntriesColClassName}>
                    {t(($) => $['settings.ipPolicyColumnIpEntries'], { ns: 'common' })}
                  </div>
                  <div role="columnheader" className={policyUsedByColClassName}>
                    {t(($) => $['settings.ipPolicyColumnUsedBy'], { ns: 'common' })}
                  </div>
                  <div role="columnheader" className={policyUpdatedColClassName}>
                    {t(($) => $['settings.ipPolicyColumnUpdatedAt'], { ns: 'common' })}
                  </div>
                  <div role="columnheader" className={policyActionsColClassName}>
                    <span className="sr-only">
                      {t(($) => $['operation.moreActions'], { ns: 'common' })}
                    </span>
                  </div>
                </div>
                {groups.map((group) => (
                  <PolicyItem
                    key={group.id}
                    group={group}
                    canMutate={canMutate}
                    policyDialog={policyDialog}
                    deleteDialog={deleteDialog}
                    onFormOpen={handleFormOpen}
                  />
                ))}
              </div>
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar orientation="horizontal" className="bottom-0">
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      )}

      {canMutate && (
        <DeletePolicyDialog dialog={deleteDialog} groups={groups} fallbackFocus={titleRef} />
      )}
      {canMutate && (
        <Dialog
          handle={createDialog}
          disablePointerDismissal
          onOpenChange={(open, details) =>
            handleDialogOpenChange(open, details, createGroup.isPending)
          }
        >
          <IpPolicyDialogContent
            finalFocus={() =>
              isEmpty && queryClient.getQueryData(groupsQuery.queryKey)?.groups.length
                ? titleRef.current
                : (createButtonRef.current ?? titleRef.current)
            }
          >
            <IpPolicyForm
              mode="create"
              isPending={createGroup.isPending}
              dismissDisabled={createGroup.isPending}
              onValidateEntries={handleValidateEntries}
              onSubmit={(input) => submitPolicy(null, input)}
            />
          </IpPolicyDialogContent>
        </Dialog>
      )}
      <Dialog
        handle={policyDialog}
        disablePointerDismissal={canMutate}
        onOpenChange={(open, details) =>
          handleDialogOpenChange(open, details, updateGroup.isPending)
        }
      >
        {({ payload: request }) => {
          if (!request) return null
          return (
            <IpPolicyDialogContent finalFocus={() => request.opener.current ?? titleRef.current}>
              <EditPolicySession
                request={request}
                recovery={recovery}
                canMutate={canMutate}
                isSaving={updateGroup.isPending}
                onRetry={(groupId) => {
                  const session = formAnalyticsRef.current
                  if (policyDialog.isOpen && session)
                    void refreshGroupsAfterConflict(groupId, session)
                }}
                onValidateEntries={handleValidateEntries}
                onSubmit={submitPolicy}
              />
            </IpPolicyDialogContent>
          )
        }}
      </Dialog>
    </div>
  )
}
