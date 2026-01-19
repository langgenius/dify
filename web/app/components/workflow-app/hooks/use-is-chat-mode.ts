import { useParams } from 'next/navigation'
import { appStoreSelectors, useAppStore } from '@/app/components/app/store'
import { AppModeEnum } from '@/types/app'

export const useIsChatMode = () => {
  const { appId } = useParams()
  const appDetail = useAppStore(appStoreSelectors.appDetails(appId as string))

  return appDetail?.mode === AppModeEnum.ADVANCED_CHAT
}
