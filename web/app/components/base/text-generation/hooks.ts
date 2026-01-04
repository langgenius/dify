import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import { ssePost } from '@/service/base'

export const useTextGeneration = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [isResponding, setIsResponding] = useState(false)
  const [completion, setCompletion] = useState('')
  const [messageId, setMessageId] = useState<string | null>(null)

  const handleSend = async (
    url: string,
    data: any,
  ) => {
    if (isResponding) {
      notify({ type: 'info', message: t('errorMessage.waitForResponse', { ns: 'appDebug' }) })
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
