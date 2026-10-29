import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'

export function useMarketplacePublish(appId?: string) {
  const { t } = useTranslation(['workflow'])
  const [isPublishing, setIsPublishing] = useState(false)

  async function publish() {
    if (!appId || isPublishing) return

    setIsPublishing(true)
    try {
      const response = await consoleClient.apps.byAppId.publishToCreatorsPlatform.post({
        params: { app_id: appId },
      })
      if (response.redirect_url) window.open(response.redirect_url, '_blank')
    } catch {
      toast.error(t(($) => $['common.publishToMarketplaceFailed'], { ns: 'workflow' }))
    } finally {
      setIsPublishing(false)
    }
  }

  return {
    isPublishing,
    publish,
  }
}
