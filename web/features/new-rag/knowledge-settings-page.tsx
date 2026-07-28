'use client'

import type { KnowledgeFsExternalAccessResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import { useMembers } from '@/service/use-common'
import { KnowledgeSettingsForm } from './knowledge-settings-form'

const READ_ONLY_EXTERNAL_ACCESS: KnowledgeFsExternalAccessResponse = {
  agent_enabled: false,
  mcp_enabled: false,
  revision: 1,
  service_api_enabled: false,
  workflow_enabled: false,
}

function KnowledgeSettingsSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-2" role="status">
      <SkeletonRectangle className="h-5 w-28 rounded-md" />
      <div className="flex gap-1">
        <SkeletonRectangle className="h-8 w-45 rounded-md" />
        <SkeletonRectangle className="h-8 flex-1 rounded-lg" />
      </div>
      <div className="flex gap-1">
        <SkeletonRectangle className="h-20 w-45 rounded-md" />
        <SkeletonRectangle className="h-20 flex-1 rounded-lg" />
      </div>
      <div className="flex gap-1">
        <SkeletonRectangle className="h-9 w-45 rounded-md" />
        <SkeletonRectangle className="h-9 flex-1 rounded-lg" />
      </div>
      <div className="h-px bg-divider-subtle" />
      <div className="flex gap-1">
        <SkeletonRectangle className="h-7 w-45 rounded-md" />
        <SkeletonRectangle className="h-7 flex-1 rounded-md" />
      </div>
      <div className="h-px bg-divider-subtle" />
      <div className="flex gap-1">
        <SkeletonRectangle className="h-20 w-45 rounded-md" />
        <div className="flex flex-1 flex-col gap-3">
          <SkeletonRectangle className="h-16 w-full rounded-lg" />
          <SkeletonRectangle className="h-16 w-full rounded-lg" />
          <SkeletonRectangle className="h-16 w-full rounded-lg" />
          <SkeletonRectangle className="h-8 w-48 rounded-lg" />
          <div className="flex gap-4">
            <SkeletonRectangle className="h-16 flex-1 rounded-lg" />
            <SkeletonRectangle className="h-16 flex-1 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function KnowledgeSettingsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')
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
    <main className="min-h-full px-6 pt-5 pb-6 sm:pr-6 sm:pl-20">
      <div className="flex flex-col gap-0.5">
        <h1 className="system-xl-semibold text-text-primary">{tSettings(($) => $.title)}</h1>
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.settings.pageDescription'])}
        </p>
      </div>

      <div className="mt-3 w-full max-w-[784px]">
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
            key={[
              spaceQuery.data.resource_version,
              settingsQuery.data.revision,
              externalAccessQuery.data?.revision ?? 0,
              permissionsQuery.data?.data.map((permission) => permission.revision).join('-') ?? '',
            ].join(':')}
            externalAccess={externalAccessQuery.data ?? READ_ONLY_EXTERNAL_ACCESS}
            members={membersQuery.data?.accounts ?? []}
            permissions={permissionsQuery.data?.data ?? []}
            settings={settingsQuery.data}
            space={spaceQuery.data}
          />
        )}
      </div>
    </main>
  )
}
