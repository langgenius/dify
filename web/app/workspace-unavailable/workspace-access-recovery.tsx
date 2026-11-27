'use client'

import type { GetWorkspacesResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Select, SelectTrigger } from '@langgenius/dify-ui/select'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { DifyLogo } from '@/app/components/base/logo/dify-logo'
import { WorkplaceSelectorContent } from '@/app/components/header/account-menu/workplace-selector'
import { consoleQuery } from '@/service/console'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { basePath } from '@/utils/var'

const selectWorkspaces = ({ workspaces }: GetWorkspacesResponse) =>
  [...workspaces].sort((a, b) => Number(b.current) - Number(a.current))

export function WorkspaceAccessRecovery() {
  const { t } = useTranslation(['navigation', 'billing', 'common'])
  const switchLabelId = useId()
  const workspacesQuery = useQuery(
    consoleQuery.workspaces.get.queryOptions({
      meta: { errorToast: false },
      select: selectWorkspaces,
    }),
  )
  const switchWorkspace = useMutation(
    consoleQuery.workspaces.switch.post.mutationOptions({
      meta: { errorToast: false },
      onSuccess: () => location.assign(`${location.origin}${basePath}/`),
    }),
  )
  const workspaces = workspacesQuery.data ?? []
  const currentWorkspace = workspaces.find((workspace) => workspace.current)
  const error = useRequestErrorMessage(
    switchWorkspace.error ?? (workspacesQuery.isLoadingError ? workspacesQuery.error : null),
  )

  return (
    <main className="row-start-2 flex min-w-0 flex-col items-center gap-10 p-4 text-center">
      <div className="flex w-full max-w-220 flex-col items-center gap-3">
        <DifyLogo alt="Dify" />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl/10 font-semibold text-text-primary">
            {t(($) => $['workspaceUnavailable.title'])}
          </h1>
          <p className="system-md-regular wrap-break-word text-text-tertiary">
            {currentWorkspace?.name ? (
              <Trans
                ns="navigation"
                i18nKey={($) => $['workspaceUnavailable.description']}
                values={{ workspaceName: currentWorkspace.name }}
                components={{ workspace: <strong className="font-semibold text-text-secondary" /> }}
              />
            ) : (
              t(($) => $['workspaceUnavailable.descriptionWithoutName'])
            )}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-center gap-2">
        <Select<string>
          value={currentWorkspace?.id ?? null}
          onValueChange={(workspaceId) => {
            if (workspaceId && workspaceId !== currentWorkspace?.id && !switchWorkspace.isPending)
              switchWorkspace.mutate({ body: { tenant_id: workspaceId } })
          }}
        >
          <SelectTrigger
            size="large"
            disabled={!workspaces.length || switchWorkspace.isPending}
            aria-labelledby={switchLabelId}
            className="w-fit bg-components-button-tertiary-bg ps-4 pe-2 system-md-medium text-components-button-tertiary-text data-placeholder:text-components-button-tertiary-text"
          >
            <span id={switchLabelId}>{t(($) => $['workspaceUnavailable.switchWorkspace'])}</span>
          </SelectTrigger>
          <WorkplaceSelectorContent
            workspaces={workspaces}
            unavailableWorkspace={
              currentWorkspace && {
                id: currentWorkspace.id,
                label: t(($) => $['plansCommon.unavailable'], { ns: 'billing' }),
              }
            }
            align="center"
            popupClassName="w-[min(20rem,var(--available-width))]"
          />
        </Select>
        {error && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {error}
          </p>
        )}
        {workspacesQuery.isLoadingError && (
          <Button variant="ghost" onClick={() => void workspacesQuery.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        )}
        {workspacesQuery.isSuccess && !workspaces.length && (
          <p role="status" className="system-sm-regular text-text-tertiary">
            {t(($) => $['mainNav.workspace.noResults'])}
          </p>
        )}
      </div>
    </main>
  )
}
