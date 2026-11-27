import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { useRequestErrorMessage } from '@/service/use-request-error-message'

type Props = Readonly<{
  error: unknown
  isRetrying?: boolean
  onRetry: () => void
  className?: string
}>

/** A credential read that failed on its first load, shown in place of the control it fills. */
const PluginAuthLoadError = ({ error, isRetrying, onRetry, className }: Props) => {
  const { t } = useTranslation(['common'])
  const message = useRequestErrorMessage(error)
  if (!message) return null
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-2 rounded-lg bg-background-section-burn px-2.5 py-1.5 system-xs-regular text-text-destructive',
        className,
      )}
    >
      <span className="min-w-0 grow wrap-break-word">{message}</span>
      <Button size="small" className="shrink-0" loading={isRetrying} onClick={onRetry}>
        {t(($) => $['operation.retry'], { ns: 'common' })}
      </Button>
    </div>
  )
}

export default PluginAuthLoadError
