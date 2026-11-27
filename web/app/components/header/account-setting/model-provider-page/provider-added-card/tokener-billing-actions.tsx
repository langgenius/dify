import { Button } from '@langgenius/dify-ui/button'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { consoleQuery } from '@/service/console'

type BillingAction = 'buy' | 'history'

export function TokenerBillingActions() {
  const { t } = useTranslation(['modelProvider'])
  const canManageBilling = useAtomValue(isCurrentWorkspaceManagerAtom)
  const openAsyncWindow = useAsyncWindowOpen()
  const { mutateAsync: createBillingLink } = useMutation(
    consoleQuery.workspaces.current.modelProviders.tokenerBillingLink.post.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const [openingAction, setOpeningAction] = useState<BillingAction | null>(null)
  const [hasOpenError, setHasOpenError] = useState(false)

  if (!canManageBilling) return null

  const openBilling = async (action: BillingAction) => {
    if (openingAction) return
    setOpeningAction(action)
    setHasOpenError(false)
    try {
      await openAsyncWindow(
        async () => {
          const { url } = await createBillingLink(undefined)
          return url
        },
        { onError: () => setHasOpenError(true) },
      )
    } finally {
      setOpeningAction(null)
    }
  }

  return (
    <div className="mb-2 flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          size="small"
          variant="secondary"
          loading={openingAction === 'history'}
          disabled={openingAction === 'buy'}
          onClick={() => void openBilling('history')}
        >
          {t(($) => $['modelProvider.tokenerPurchaseHistory'])}
        </Button>
        <Button
          size="small"
          variant="primary"
          loading={openingAction === 'buy'}
          disabled={openingAction === 'history'}
          onClick={() => void openBilling('buy')}
        >
          {t(($) => $['modelProvider.tokenerBuyCredits'])}
        </Button>
      </div>
      {hasOpenError && (
        <p role="alert" className="system-xs-regular text-text-destructive">
          {t(($) => $['modelProvider.tokenerBillingLinkUnavailable'])}
        </p>
      )}
    </div>
  )
}
