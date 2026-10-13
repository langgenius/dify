import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { ssePost } from '@/service/base'

type SendOptions = {
  onNotifyError?: (error: Error) => void
}

export const useTextGeneration = () => {
  const { t } = useTranslation(['appDebug'])
  const [isResponding, setIsResponding] = useState(false)
  const [completion, setCompletion] = useState('')
  const [messageId, setMessageId] = useState<string | null>(null)
  const handleSend = async (url: string, data: any, { onNotifyError }: SendOptions = {}) => {
    if (isResponding) {
      toast.info(t(($) => $['errorMessage.waitForResponse'], { ns: 'appDebug' }))
      return false
    }
    setIsResponding(true)
    setCompletion('')
    setMessageId('')
    let res: string[] = []
    ssePost(
      url,
      {
        body: {
          response_mode: 'streaming',
          ...data,
        },
      },
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
        onError(error) {
          const message = error.message
          setIsResponding(false)
          if (error.name === 'AbortError') return
          if (onNotifyError) onNotifyError(error)
          else toast.error(message)
        },
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
