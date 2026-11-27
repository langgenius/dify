import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

type Props = Readonly<{
  error: unknown
  isRetrying?: boolean
  onRetry: () => void
  className?: string
}>

/** A chat read that failed on its first load, shown where its content would be. */
const ChatLoadError = ({ error, isRetrying, onRetry, className }: Props) => {
  const { t } = useTranslation(['common'])
  const message = useRequestErrorMessage(error)
  if (!message) return null
  return (
    <Alert type="error" className={className}>
      <AlertTitle>{message}</AlertTitle>
      <AlertActions>
        <Button size="small" loading={isRetrying} onClick={onRetry}>
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </AlertActions>
    </Alert>
  )
}

export default ChatLoadError
