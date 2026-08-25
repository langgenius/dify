import type { MessageStatus } from '@dify/contracts/api/web/types.gen'
import { zMessageStatus } from '@dify/contracts/api/web/zod.gen'
import { useTranslation } from 'react-i18next'

type StoppedNoticeProps = {
  status?: MessageStatus
}

const StoppedNotice = ({ status }: StoppedNoticeProps) => {
  const { t } = useTranslation()

  if (status !== zMessageStatus.enum.stopped) return null

  return (
    <div className="mt-1 flex items-center system-xs-regular text-text-tertiary">
      <span
        aria-hidden
        className="mr-1 i-ri-stop-circle-fill size-3.5 shrink-0 text-text-warning-secondary"
      />
      <span>{t(($) => $['chat.answerInterrupted'], { ns: 'share' })}</span>
    </div>
  )
}

export default StoppedNotice
