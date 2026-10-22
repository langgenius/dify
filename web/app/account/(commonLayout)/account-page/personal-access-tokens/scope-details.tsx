import { Button } from '@langgenius/dify-ui/button'
import { DialogClose, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import WorkspaceRole from './workspace-role'

export default function ScopeDetails({ tokenId }: { tokenId: string }) {
  const { t } = useTranslation(['accountSettings', 'common', 'dataset'])
  const query = useQuery(
    consoleQuery.account.personalAccessTokens.byTokenId.get.queryOptions({
      context: { silent: true },
      input: { params: { token_id: tokenId } },
      staleTime: 0,
    }),
  )
  const detail = query.data
  const expiration = detail?.token.expires_at
    ? new Date(detail.token.expires_at).toISOString().slice(0, 10)
    : null
  const unavailableResourceCount =
    detail?.resources.filter(
      (resource) => !resource.available && resource.reason !== 'workspace_not_current',
    ).length ?? 0
  const unavailableWorkspaceCount =
    detail?.workspaces.filter((workspace) => !workspace.available).length ?? 0
  const unavailableCount = unavailableResourceCount + unavailableWorkspaceCount
  return (
    <>
      <div className="px-6 pt-6 pr-14 pb-2">
        <DialogTitle>{t(($) => $['personalAccessToken.scopeTitle'])}</DialogTitle>
        <div className="mt-1">
          <DialogDescription>
            {t(($) => $['personalAccessToken.effectiveAccess'])}
          </DialogDescription>
        </div>
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute top-5 right-5"
            >
              <span aria-hidden="true" className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      </div>
      {query.isPending && (
        <div
          className="mx-6 my-3 h-64 animate-pulse rounded-lg bg-background-section"
          aria-busy="true"
        />
      )}
      {query.isError && (
        <div role="alert" className="p-6">
          {t(($) => $['resourceAccessToken.loadError'])}
          <Button onClick={() => query.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      )}
      {detail && (
        <>
          <div className="px-6 pt-2.5 pb-5 system-xs-regular text-text-tertiary">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span>{t(($) => $['resourceAccessToken.token'])}:</span>
              <span className="min-w-0 flex-1 system-sm-medium break-words text-text-secondary">
                {detail.token.name}
              </span>
              <span>
                {t(($) => $['resourceAccessToken.createdColumn'])} ·{' '}
                {new Date(detail.token.created_at).toISOString().slice(0, 10)}
              </span>
            </div>
            <p className="mt-1 text-text-destructive">
              {expiration
                ? t(($) => $['personalAccessToken.expiredDate'], { date: expiration })
                : t(($) => $['personalAccessToken.never'])}
            </p>
            {unavailableCount > 0 && (
              <p className="mt-1 text-text-warning">
                {unavailableResourceCount > 0 && unavailableWorkspaceCount > 0
                  ? t(($) => $['personalAccessToken.unavailableResourcesAndWorkspaces'], {
                      count: unavailableCount,
                    })
                  : unavailableResourceCount > 0
                    ? t(($) => $['personalAccessToken.unavailableResources'], {
                        count: unavailableCount,
                      })
                    : t(($) => $['personalAccessToken.unavailableWorkspaces'], {
                        count: unavailableCount,
                      })}
              </p>
            )}
          </div>
          <div className="max-h-115 space-y-6 overflow-y-auto px-6">
            <section aria-labelledby="pat-resource-scope">
              <h3 id="pat-resource-scope" className="mb-3 system-sm-semibold text-text-secondary">
                {t(($) => $['resourceAccessToken.resources'])}
              </h3>
              {detail.token.resource_scope_mode === 'selected' ? (
                <div className="overflow-hidden rounded-lg border border-components-panel-border">
                  <table className="w-full table-fixed text-left system-xs-regular text-text-secondary">
                    <thead className="bg-background-section text-text-tertiary">
                      <tr>
                        <th className="w-2/5 px-3 py-2 font-normal">
                          {t(($) => $['resourceAccessToken.resources'])}
                        </th>
                        <th className="w-1/3 px-3 py-2 font-normal">
                          {t(($) => $['personalAccessToken.workspace'])}
                        </th>
                        <th className="px-3 py-2 font-normal">
                          {t(($) => $['personalAccessToken.status'])}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.resources.map((resource) => {
                        const resourceType =
                          resource.resource_type === 'app'
                            ? t(($) => $['resourceAccessToken.app'])
                            : resource.resource_type === 'dataset'
                              ? t(($) => $['resourceAccessToken.knowledge'])
                              : t(($) => $['personalAccessToken.appRunner'])
                        const deployments =
                          resource.resource_type === 'app' && resource.app_runners?.length
                            ? resource.app_runners.map((runner) =>
                                runner.display_name.split(' / ').at(-1),
                              )
                            : resource.resource_type === 'app'
                              ? [
                                  t(($) => $['metadata.datasetMetadata.builtIn'], {
                                    ns: 'dataset',
                                  }),
                                ]
                              : resource.resource_type === 'app_runner'
                                ? [resource.display_name.split(' / ').at(-1)]
                                : []
                        return (
                          <tr
                            key={`${resource.resource_type}:${resource.resource_id}`}
                            className="border-t border-components-panel-border"
                          >
                            <td className="p-3 break-words">
                              <div className="system-sm-medium">{resource.display_name}</div>
                              <div className="mt-0.5 system-xs-regular text-text-tertiary">
                                {resourceType} · ID: {resource.resource_id}
                              </div>
                            </td>
                            <td className="p-3 break-words">
                              {resource.workspace_name.replace(/'s Workspace$/, '')}
                              {deployments.length > 0 ? (
                                <>
                                  {' · '}
                                  {deployments.join(', ')}
                                </>
                              ) : null}
                            </td>
                            <td className={resource.available ? 'p-3' : 'p-3 text-text-warning'}>
                              {resource.available
                                ? t(($) => $['personalAccessToken.allowed'])
                                : resource.reason === 'workspace_not_current'
                                  ? t(($) => $['personalAccessToken.workspaceNotCurrent'])
                                  : t(($) => $['personalAccessToken.accessRemoved'])}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="system-xs-regular text-text-tertiary">
                  {detail.token.resource_scope_mode === 'all'
                    ? t(($) => $['personalAccessToken.allIncludingFuture'])
                    : t(($) => $['personalAccessToken.noResourceCalls'])}
                </p>
              )}
            </section>
            <section aria-labelledby="pat-workspace-scope">
              <h3 id="pat-workspace-scope" className="mb-3 system-sm-semibold text-text-secondary">
                {t(($) => $['personalAccessToken.manageWorkspaces'])}
              </h3>
              {detail.token.workspace_scope_mode === 'selected' ? (
                <div className="overflow-hidden rounded-lg border border-components-panel-border">
                  <table className="w-full table-fixed text-left system-xs-regular text-text-secondary">
                    <thead className="bg-background-section text-text-tertiary">
                      <tr>
                        <th className="w-2/5 px-3 py-2 font-normal">
                          {t(($) => $['personalAccessToken.workspace'])}
                        </th>
                        <th className="w-1/3 px-3 py-2 font-normal">
                          {t(($) => $['personalAccessToken.yourRole'])}
                        </th>
                        <th className="px-3 py-2 font-normal">
                          {t(($) => $['personalAccessToken.status'])}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.workspaces.map((workspace) => (
                        <tr
                          key={workspace.workspace_id}
                          className="border-t border-components-panel-border"
                        >
                          <td className="p-3 system-sm-medium break-words">
                            {workspace.display_name}
                          </td>
                          <td className="p-3 text-text-tertiary">
                            <WorkspaceRole role={workspace.role} />
                          </td>
                          <td className={workspace.available ? 'p-3' : 'p-3 text-text-warning'}>
                            {workspace.available
                              ? t(($) => $['personalAccessToken.allowed'])
                              : t(($) => $['personalAccessToken.notMember'])}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="system-xs-regular text-text-tertiary">
                  {detail.token.workspace_scope_mode === 'all'
                    ? t(($) => $['personalAccessToken.allIncludingFuture'])
                    : t(($) => $['personalAccessToken.noWorkspaceOperations'])}
                </p>
              )}
            </section>
          </div>
        </>
      )}
      <div className="flex justify-end px-6 py-4">
        <DialogClose render={<Button />}>
          {t(($) => $['operation.close'], { ns: 'common' })}
        </DialogClose>
      </div>
    </>
  )
}
