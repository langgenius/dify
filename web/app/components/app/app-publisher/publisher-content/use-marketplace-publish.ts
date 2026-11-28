import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getErrorMessage } from '@/utils/error-message'

export function useMarketplacePublish(appId?: string) {
  const { t } = useTranslation(['workflow'])
  // Hook-level handlers keep running if the editor unmounts before the request settles.
  const { isPending: isPublishing, mutate } = useMutation(
    consoleQuery.apps.byAppId.publishToCreatorsPlatform.post.mutationOptions({
      meta: { errorToast: false },
      onSuccess: (response) => {
        if (response.redirect_url) window.open(response.redirect_url, '_blank')
      },
      onError: (error) => {
        toast.error(
          getErrorMessage(error) ??
            t(($) => $['common.publishToMarketplaceFailed'], { ns: 'workflow' }),
        )
      },
    }),
  )

  function publish() {
    if (!appId || isPublishing) return

    mutate({ params: { app_id: appId } })
  }

  return {
    isPublishing,
    publish,
  }
}
