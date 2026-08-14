import { toast } from '@langgenius/dify-ui/toast'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ssePost } from '@/service/base'

type SendOptions = {
  onNotifyError?: (message: string, code?: string) => void
}

export const useTextGeneration = () => {
  const { t } = useTranslation()
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
