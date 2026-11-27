'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { logoutMutationOptions } from '@/service/common-queries'

export default function SwitchAccount({ redirectTo }: { redirectTo: string }) {
  const { t } = useTranslation(['common', 'oauth'])
  const { mutate, isError, error, isPending, isSuccess } = useMutation(
    logoutMutationOptions({ redirectTo }),
  )

  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3">
      {isError && (
        <p role="alert" className="system-sm-regular text-text-destructive">
          {error.message || t(($) => $['api.actionFailed'], { ns: 'common' })}
        </p>
      )}
      <Button variant="primary" loading={isPending || isSuccess} onClick={() => mutate()}>
        {isError
          ? t(($) => $['operation.retry'], { ns: 'common' })
          : t(($) => $.switchAccount, { ns: 'oauth' })}
      </Button>
    </div>
  )
}
