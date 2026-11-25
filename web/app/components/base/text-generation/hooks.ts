import type { StreamSender } from '@/service/event-stream'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { streamEvents } from '@/service/event-stream'

type SendOptions = {
  onNotifyError?: (message: string, code?: string) => void
}

export const useTextGeneration = () => {
  const { t } = useTranslation(['appDebug'])
  const [isResponding, setIsResponding] = useState(false)
  const [completion, setCompletion] = useState('')
  const [messageId, setMessageId] = useState<string | null>(null)
  const handleSend = async (
    send: StreamSender,
    data: Record<string, unknown>,
    { onNotifyError }: SendOptions = {},
  ) => {
    if (isResponding) {
      toast.info(t(($) => $['errorMessage.waitForResponse'], { ns: 'appDebug' }))
      return false
    }
    setIsResponding(true)
    setCompletion('')
    setMessageId('')
    let res: string[] = []
    streamEvents(
      (options) =>
        send(
          {
            response_mode: 'streaming',
            ...data,
          },
          options,
        ),
      {
        onData: (data: string, _isFirstMessage: boolean, { messageId }) => {
          res.push(data)
          setCompletion(res.join(''))
          setMessageId(messageId)
        },
        onMessageReplace: (messageReplace) => {
          res = [messageReplace.answer]
          setCompletion(res.join(''))
        },
        onCompleted() {
          setIsResponding(false)
        },
        onError() {
          setIsResponding(false)
        },
        onNotifyError,
      },
    )
    return true
  }
  return {
    completion,
    isResponding,
    setIsResponding,
    handleSend,
    messageId,
  }
}
