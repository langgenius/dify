'use client'

import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import {
  AlertDialog,
  AlertDialogContent,
  createAlertDialogHandle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { parseAsInteger, useQueryState } from 'nuqs'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import CopyToken from './copy-token'
import DeleteToken from './delete-token'
import ScopeDetails from './scope-details'
import TokenActions from './token-actions'
import TokenForm from './token-form'
import TokenTime from './token-time'

export default function PersonalAccessTokens() {
  const { t } = useTranslation(['accountSettings', 'common'])
  const [requestedPage, setRequestedPage] = useQueryState(
    'patPage',
    parseAsInteger.withDefault(1).withOptions({ history: 'push' }),
  )
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState<PersonalAccessTokenResponse | null>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const createButtonRef = useRef<HTMLButtonElement | null>(null)
  const deleteDialogHandle = useMemo(() => createAlertDialogHandle(), [])
  const page = Math.max(1, requestedPage)
  const query = useQuery(
    consoleQuery.account.personalAccessTokens.get.queryOptions({
      context: { silent: true },
      input: { query: { page, limit: 20 } },
    }),
  )

  return (
    <>
      <section className="mb-8" aria-labelledby="personal-access-tokens-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2
              id="personal-access-tokens-heading"
              className="system-sm-semibold text-text-secondary"
            >
              {t(($) => $['personalAccessToken.title'])}
            </h2>
            <p className="mt-1 body-xs-regular text-text-tertiary">
              {t(($) => $['personalAccessToken.description'])}
            </p>
          </div>
          <Dialog>
            <DialogTrigger render={<Button ref={createButtonRef} variant="primary" />}>
              {t(($) => $['personalAccessToken.createButton'])}
            </DialogTrigger>
            <DialogContent className="w-150 has-[[data-pat-created]]:w-130">
              <TokenForm />
            </DialogContent>
          </Dialog>
        </div>
        {query.isPending && (
          <div className="h-40 animate-pulse rounded-lg bg-background-section" aria-busy="true" />
        )}
        {query.isError && (
          <div role="alert">
            {t(($) => $['resourceAccessToken.loadError'])}
            <Button onClick={() => query.refetch()}>
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        )}
        {query.data && (
          <>
            {query.data.data.length === 0 ? (
              <div className="flex h-40 items-center justify-center rounded-lg bg-background-section system-sm-medium text-text-primary">
                {t(($) => $['personalAccessToken.noTokens'])}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-divider-regular bg-components-panel-bg">
                <table className="w-full min-w-200 table-fixed text-left system-xs-regular text-text-secondary">
                  <caption className="sr-only">{t(($) => $['personalAccessToken.title'])}</caption>
                  <thead className="h-9 system-xs-medium text-text-tertiary">
                    <tr>
                      <th className="w-3/16 px-3 font-medium">
                        {t(($) => $['resourceAccessToken.name'])}
                      </th>
                      <th className="w-1/4 px-3 font-medium">
                        {t(($) => $['personalAccessToken.access'])}
                      </th>
                      <th className="w-1/5 px-3 font-medium">
                        {t(($) => $['personalAccessToken.status'])}
                      </th>
                      <th className="px-3 font-medium">
                        {t(($) => $['personalAccessToken.expires'])}
                      </th>
                      <th className="px-3 font-medium">
                        {t(($) => $['personalAccessToken.lastUsed'])}
                      </th>
                      <th className="w-24 px-3 text-right font-medium">
                        {t(($) => $['resourceAccessToken.actions'])}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.data.map((token) => (
                      <tr key={token.id} className="h-16 border-t border-divider-regular">
                        <td className="px-3">
                          <div className="flex flex-col items-start">
                            <Dialog>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <DialogTrigger className="max-w-full truncate font-medium underline underline-offset-2" />
                                  }
                                >
                                  {token.name}
                                </TooltipTrigger>
                                <TooltipContent>{token.name}</TooltipContent>
                              </Tooltip>
                              <DialogContent className="w-150 has-[[data-pat-created]]:w-130">
                                <ScopeDetails tokenId={token.id} />
                              </DialogContent>
                            </Dialog>
                            <CopyToken token={token} />
                          </div>
                        </td>
                        <td className="px-3">
                          <span>
                            {token.resource_scope_mode === 'all'
                              ? t(($) => $['personalAccessToken.allResources'])
                              : token.resource_scope_mode === 'none'
                                ? t(($) => $['personalAccessToken.none'])
                                : t(($) => $['personalAccessToken.resourcesCount'], {
                                    count: token.resource_count,
                                  })}
                          </span>
                          {' · '}
                          <span>
                            {token.workspace_scope_mode === 'all'
                              ? t(($) => $['personalAccessToken.allWorkspaces'])
                              : token.workspace_scope_mode === 'none'
                                ? t(($) => $['personalAccessToken.none'])
                                : t(($) => $['personalAccessToken.workspacesCount'], {
                                    count: token.workspace_count,
                                  })}
                          </span>
                        </td>
                        <td className="px-3">
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={
                                token.status === 'expired'
                                  ? 'rounded-full bg-background-section px-2.5 py-1 text-text-tertiary'
                                  : 'rounded-full bg-components-badge-bg-green-soft px-2.5 py-1 text-text-success'
                              }
                            >
                              {token.status === 'expired'
                                ? t(($) => $['personalAccessToken.expired'])
                                : t(($) => $['personalAccessToken.active'])}
                            </span>
                            {token.unavailable_count > 0 && (
                              <span className="rounded-full bg-components-badge-bg-orange-soft px-2.5 py-1 text-text-warning">
                                {t(($) => $['personalAccessToken.unavailableCount'], {
                                  count: token.unavailable_count,
                                })}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3">
                          <TokenTime value={token.expires_at} expiration />
                        </td>
                        <td className="px-3 text-text-tertiary">
                          <TokenTime value={token.last_used_at} />
                        </td>
                        <td className="px-2">
                          <TokenActions
                            token={token}
                            onDelete={(target, trigger) => {
                              setDeleting(target)
                              deleteTriggerRef.current = trigger
                            }}
                            deleteDialogHandle={deleteDialogHandle}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(page > 1 || query.data.has_more) && (
              <div className="mt-3 flex justify-end gap-2">
                <Button disabled={page === 1} onClick={() => setRequestedPage(page - 1)}>
                  {t(($) => $['resourceAccessToken.previous'])}
                </Button>
                <Button disabled={!query.data.has_more} onClick={() => setRequestedPage(page + 1)}>
                  {t(($) => $['resourceAccessToken.next'])}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      <AlertDialog handle={deleteDialogHandle} open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent
          className="w-110"
          finalFocus={() =>
            deleteTriggerRef.current?.isConnected
              ? deleteTriggerRef.current
              : createButtonRef.current
          }
        >
          {deleting && <DeleteToken token={deleting} onClose={() => setDeleteOpen(false)} />}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
