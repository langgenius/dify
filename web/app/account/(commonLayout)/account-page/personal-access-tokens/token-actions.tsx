import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import { AlertDialogTrigger } from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import TokenForm from './token-form'

function SavedTokenForm({
  tokenId,
  duplicate,
  onSaved,
}: {
  tokenId: string
  duplicate: boolean
  onSaved: () => void
}) {
  const { t } = useTranslation(['accountSettings', 'common'])
  const [sessionVersion, setSessionVersion] = useState<number | null>(null)
  const query = useQuery(
    consoleQuery.account.personalAccessTokens.byTokenId.get.queryOptions({
      context: { silent: true },
      input: { params: { token_id: tokenId } },
      staleTime: 0,
    }),
  )
  if (query.data)
    return (
      <>
        {query.isError && (
          <p role="alert" className="px-6 text-text-warning">
            {t(($) => $['resourceAccessToken.loadError'])}
          </p>
        )}
        <TokenForm
          key={sessionVersion ?? 'initial'}
          initial={query.data}
          duplicate={duplicate}
          onSaved={onSaved}
          onReload={async () => {
            const result = await query.refetch()
            if (result.isSuccess) setSessionVersion(result.data.token.version)
          }}
        />
      </>
    )
  return (
    <div className="p-6">
      <DialogTitle>
        {duplicate
          ? t(($) => $['personalAccessToken.duplicateTitle'])
          : t(($) => $['personalAccessToken.editTitle'])}
      </DialogTitle>
      {query.isError ? (
        <div role="alert">
          {t(($) => $['resourceAccessToken.loadError'])}
          <Button onClick={() => query.refetch()}>
            {t(($) => $['operation.retry'], { ns: 'common' })}
          </Button>
        </div>
      ) : (
        <div className="h-64 animate-pulse bg-background-section" aria-busy="true" />
      )}
    </div>
  )
}

export default function TokenActions({
  token,
  onDelete,
  deleteDialogHandle,
}: {
  token: PersonalAccessTokenResponse
  onDelete: (token: PersonalAccessTokenResponse, trigger: HTMLButtonElement) => void
  deleteDialogHandle: AlertDialogHandle
}) {
  const { t } = useTranslation(['common'])
  const [editing, setEditing] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  return (
    <div className="flex items-center justify-end gap-1">
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogTrigger
          render={
            <IconButton
              aria-label={t(($) => $['operation.edit'])}
              disabled={token.status === 'expired'}
              size="sm"
            >
              <span aria-hidden="true" className="i-ri-edit-line size-4" />
            </IconButton>
          }
        />
        <DialogContent className="w-150 has-[[data-pat-created]]:w-130">
          <SavedTokenForm tokenId={token.id} duplicate={false} onSaved={() => setEditing(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={duplicating} onOpenChange={setDuplicating}>
        <DialogTrigger
          render={
            <IconButton aria-label={t(($) => $['operation.duplicate'])} size="sm">
              <span aria-hidden="true" className="i-ri-file-copy-line size-4" />
            </IconButton>
          }
        />
        <DialogContent className="w-150 has-[[data-pat-created]]:w-130">
          <SavedTokenForm tokenId={token.id} duplicate onSaved={() => setDuplicating(false)} />
        </DialogContent>
      </Dialog>
      <AlertDialogTrigger
        handle={deleteDialogHandle}
        onClick={(event) => onDelete(token, event.currentTarget)}
        render={
          <IconButton size="sm" tone="destructive" aria-label={t(($) => $['operation.delete'])}>
            <span aria-hidden="true" className="i-ri-delete-bin-line size-4" />
          </IconButton>
        }
      />
    </div>
  )
}
