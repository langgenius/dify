import { useStore as useAppStore } from '@/app/components/app/store'
import { AppModeEnum } from '@/types/app'

export const useIsChatMode = () => {
  const appDetail = useAppStore(s => s.appDetail)

  return appDetail?.mode === AppModeEnum.ADVANCED_CHAT
}
