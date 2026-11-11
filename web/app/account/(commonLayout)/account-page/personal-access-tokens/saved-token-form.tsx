import { Button } from '@langgenius/dify-ui/button'
import { DialogTitle } from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import TokenForm from './token-form'

export type SavedTokenFormPayload = {
  tokenId: string
  duplicate: boolean
}

export default function SavedTokenForm({
  tokenId,
  duplicate,
  onSaved,
}: SavedTokenFormPayload & { onSaved: () => void }) {
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
