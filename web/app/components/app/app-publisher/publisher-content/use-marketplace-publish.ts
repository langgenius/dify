import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { publishToCreatorsPlatform } from '@/service/apps'

export function useMarketplacePublish(appId?: string) {
  const { t } = useTranslation()
  const [isPublishing, setIsPublishing] = useState(false)

  async function publish() {
    if (!appId || isPublishing) return

    setIsPublishing(true)
    try {
      const response = await publishToCreatorsPlatform({ appID: appId })
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
