import type { PersonalAccessTokenResponse } from '@dify/contracts/api/console/account/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { useTokenClipboard } from './use-token-clipboard'

export default function CopyToken({ token }: { token: PersonalAccessTokenResponse }) {
  const { t } = useTranslation(['common', 'accountSettings'])
  const { copied, failed, reset, copySecret } = useTokenClipboard()
  const mutation = useMutation(
    consoleQuery.account.personalAccessTokens.byTokenId.secret.post.mutationOptions({
      gcTime: 0,
      context: { silent: true },
    }),
  )
  const label = copied ? t(($) => $['operation.copied']) : t(($) => $['operation.copy'])
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              className="mt-1 h-auto px-0 py-0 font-mono system-xs-regular text-text-tertiary"
              aria-label={label}
              disabled={token.status === 'expired'}
              loading={mutation.isPending}
              onClick={() => {
                reset()
                mutation.mutate(
                  { params: { token_id: token.id } },
                  {
                    onSuccess: async ({ secret }) => {
                      await copySecret(secret)
                      mutation.reset()
                    },
                  },
                )
              }}
            />
          }
        >
          ••••{token.secret_last_four}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      {mutation.isError && (
        <span role="alert" className="block system-xs-regular text-text-warning">
          {t(($) => $['personalAccessToken.secretUnavailable'], { ns: 'accountSettings' })}
        </span>
      )}
      {failed && (
        <span role="alert" className="block system-xs-regular text-text-warning">
          {t(($) => $['operation.copyErrorFailed'])}
        </span>
      )}
      {copied && (
        <span role="status" className="sr-only">
          {t(($) => $['operation.copied'])}
        </span>
      )}
    </>
  )
}
