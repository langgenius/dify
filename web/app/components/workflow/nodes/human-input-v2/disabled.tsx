import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export const HumanInputV2Disabled = ({ className }: { className?: string }) => {
  const { t } = useTranslation(['workflow'])

  return (
    <div
      role="status"
      className={cn(
        'rounded-md bg-state-warning-hover px-2 py-2 system-xs-regular text-text-secondary',
        className,
      )}
    >
      {t(($) => $['nodes.humanInputV2.disabled'], { ns: 'workflow' })}
    </div>
  )
}
