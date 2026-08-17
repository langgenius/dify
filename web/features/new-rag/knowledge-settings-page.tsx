'use client'

import type { KnowledgeFsExternalAccessResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useMembers } from '@/service/use-common'
import { KnowledgeSettingsForm } from './knowledge-settings-form'
import { parseKnowledgeModelCapability, validateNewKnowledgeReturnTo } from './routes'

const READ_ONLY_EXTERNAL_ACCESS: KnowledgeFsExternalAccessResponse = {
  agent_enabled: false,
  mcp_enabled: false,
  revision: 1,
  service_api_enabled: false,
  workflow_enabled: false,
}

function KnowledgeSettingsSkeleton() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')

  return (
    <div className="flex flex-col gap-4 pt-2">
      <span className="sr-only" role="status">
        {tCommon(($) => $.loading)}
      </span>
      <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
        {t(($) => $['newKnowledge.settings.basicInfo'])}
      </h2>
      <div className="flex gap-1">
        <div className="flex h-8 w-45 items-center system-sm-semibold text-text-secondary">
          {tSettings(($) => $['form.nameAndIcon'])}
        </div>
        <SkeletonRectangle className="h-8 flex-1 rounded-lg" />
      </div>
      <div className="flex gap-1">
        <div className="flex h-7 w-45 items-center system-sm-semibold text-text-secondary">
          {tSettings(($) => $['form.desc'])}
        </div>
        <SkeletonRectangle className="h-20 flex-1 rounded-lg" />
      </div>
      <div className="flex gap-1">
        <div className="flex h-7 w-45 items-center system-sm-semibold text-text-secondary">
          {tSettings(($) => $['form.permissions'])}
        </div>
        <SkeletonRectangle className="h-9 flex-1 rounded-lg" />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <SkeletonRectangle className="h-8 w-17.75 rounded-lg" />
        <SkeletonRectangle className="h-8 w-28.75 rounded-lg" />
      </div>
      <div className="h-px bg-divider-subtle" />
      <div className="flex gap-1">
        <div className="flex h-7 w-45 items-center system-sm-semibold text-text-secondary">
          {t(($) => $['newKnowledge.settings.apiAccessLabel'])}
        </div>
        <SkeletonRectangle className="h-7 flex-1 rounded-md" />
      </div>
      <div className="h-px bg-divider-subtle" />
      <div className="flex gap-1">
        <div className="w-45 shrink-0">
          <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
            {t(($) => $['newKnowledge.settings.retrievalTitle'])}
          </h2>
          <p className="body-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.settings.retrievalDescription'])}
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div>
            <div className="flex h-7 items-center system-sm-medium text-text-secondary">
              {t(($) => $['newKnowledge.settings.systemReasoningModelLabel'])}
            </div>
            <SkeletonRectangle className="h-9 w-full rounded-lg" />
          </div>
          <div>
            <div className="flex h-7 items-center system-sm-medium text-text-secondary">
              {t(($) => $['newKnowledge.settings.embeddingModelLabel'])}
            </div>
            <SkeletonRectangle className="h-9 w-full rounded-lg" />
          </div>
          <div>
            <div className="flex h-7 items-center system-sm-medium text-text-secondary">
              {tCommon(($) => $['modelProvider.rerankModel.key'])}
            </div>
            <SkeletonRectangle className="h-9 w-full rounded-lg" />
          </div>
          <SkeletonRectangle className="h-8 w-48 rounded-lg" />
          <div className="flex gap-4">
            <SkeletonRectangle className="h-16 flex-1 rounded-lg" />
            <SkeletonRectangle className="h-16 flex-1 rounded-lg" />
          </div>
        </div>
      </div>
      <div className="h-px bg-divider-subtle" />
      <div className="flex gap-1 pt-7">
        <div className="w-45 shrink-0">
          <h2 className="flex h-8 items-center system-sm-semibold text-text-destructive">
            {t(($) => $['newKnowledge.settings.dangerZone'])}
          </h2>
        </div>
        <div className="flex min-h-14.5 flex-1 items-center justify-between rounded-xl border border-components-panel-border bg-background-section px-4">
          <div>
            <p className="system-sm-medium text-text-secondary">
              {t(($) => $['newKnowledge.settings.deleteTitle'])}
            </p>
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.settings.deleteDescription'])}
            </p>
          </div>
          <SkeletonRectangle className="h-8 w-16 rounded-lg" />
        </div>
      </div>
    </div>
  )
}

export function KnowledgeSettingsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnCapability = parseKnowledgeModelCapability(searchParams.get('capability'))
  const returnTo = validateNewKnowledgeReturnTo(knowledgeSpaceId, searchParams.get('returnTo'))
  const returnWasBlockedRef = useRef(false)
  const returnInitializedRef = useRef(false)
  const spaceQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const settingsQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.settings.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
  )
  const canManageAccess =
    spaceQuery.data?.permission_keys.includes('knowledge_space_access_config') ?? false
  const permissionsQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.permissions.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    enabled: canManageAccess,
  })
  const externalAccessQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    enabled: canManageAccess,
  })
  const membersQuery = useMembers()
  const [activeDraftVersion, setActiveDraftVersion] = useState<{
    conflict: string
    form: string
  }>()

  useEffect(() => {
    if (!returnCapability || !returnTo || !settingsQuery.data) return
    const available = settingsQuery.data.capabilities[returnCapability]
    if (!returnInitializedRef.current) {
      returnInitializedRef.current = true
      returnWasBlockedRef.current = !available
      return
    }
    if (returnWasBlockedRef.current && available) router.replace(returnTo)
  }, [returnCapability, returnTo, router, settingsQuery.data])

  const isPending =
    spaceQuery.isPending ||
    settingsQuery.isPending ||
    membersQuery.isPending ||
    (canManageAccess && (permissionsQuery.isPending || externalAccessQuery.isPending))
  const hasError =
    spaceQuery.isError ||
    settingsQuery.isError ||
    membersQuery.isError ||
    (canManageAccess && (permissionsQuery.isError || externalAccessQuery.isError))
  const settingsFormVersion = [
    knowledgeSpaceId,
    spaceQuery.data?.resource_version ?? 0,
    settingsQuery.data?.revision ?? 0,
    externalAccessQuery.data?.revision ?? 0,
    permissionsQuery.data?.data
      .map((permission) => `${permission.account_id}:${permission.revision}`)
      .sort()
      .join('|') ?? '',
  ].join(':')
  const basicDraftVersion = [
    knowledgeSpaceId,
    spaceQuery.data?.resource_version ?? 0,
    permissionsQuery.data?.data
      .map((permission) => `${permission.account_id}:${permission.revision}`)
      .sort()
      .join('|') ?? '',
  ].join(':')
  const settingsFormKey = activeDraftVersion?.form ?? settingsFormVersion
  const serverConflict =
    activeDraftVersion !== undefined && activeDraftVersion.conflict !== basicDraftVersion

  const retry = () => {
    const requests: Promise<unknown>[] = [
      spaceQuery.refetch(),
      settingsQuery.refetch(),
      membersQuery.refetch(),
    ]
    if (canManageAccess) {
      requests.push(permissionsQuery.refetch(), externalAccessQuery.refetch())
    }
    void Promise.all(requests)
  }

  return (
    <div className="min-h-full w-full overflow-y-auto px-6 pt-3 pb-6">
      <div className="flex flex-col gap-0.5">
        <h1 className="system-xl-semibold text-text-primary">{tSettings(($) => $.title)}</h1>
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.settings.pageDescription'])}
        </p>
      </div>

      <div className="mt-3 w-full max-w-196">
        {isPending && <KnowledgeSettingsSkeleton />}

        {!isPending && hasError && (
          <div
            className="flex items-center gap-3 rounded-xl border border-components-panel-border bg-background-section p-4"
            role="alert"
          >
            <span aria-hidden className="i-ri-error-warning-line size-5 text-text-destructive" />
            <p className="min-w-0 flex-1 system-sm-regular text-text-secondary">
              {tCommon(($) => $['api.actionFailed'])}
            </p>
            <Button onClick={retry}>{tCommon(($) => $['operation.retry'])}</Button>
          </div>
        )}

        {!isPending && !hasError && spaceQuery.data && settingsQuery.data && (
          <KnowledgeSettingsForm
            key={settingsFormKey}
            externalAccess={externalAccessQuery.data ?? READ_ONLY_EXTERNAL_ACCESS}
            members={membersQuery.data?.accounts ?? []}
            permissions={permissionsQuery.data?.data ?? []}
            serverConflict={serverConflict}
            settings={settingsQuery.data}
            space={spaceQuery.data}
            onDraftFinish={() => setActiveDraftVersion(undefined)}
            onDraftStart={() =>
              setActiveDraftVersion(
                (current) => current ?? { conflict: basicDraftVersion, form: settingsFormVersion },
              )
            }
          />
        )}
      </div>
    </div>
  )
}
