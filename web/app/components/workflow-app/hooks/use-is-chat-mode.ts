import { useParams } from 'next/navigation'
import { useAppDetail } from '@/service/use-apps'
import { AppModeEnum } from '@/types/app'

export const useIsChatMode = () => {
  const { appId } = useParams()
  const { data: appDetail } = useAppDetail(appId as string)

  return appDetail?.mode === AppModeEnum.ADVANCED_CHAT
}
