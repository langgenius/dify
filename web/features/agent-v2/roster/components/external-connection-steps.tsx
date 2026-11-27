import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export function ExternalConnectionSteps({ step }: { step: 'connection' | 'details' }) {
  const { t } = useTranslation(['agentRoster'])
  const details = step === 'details'

  return (
    <ol className="flex items-center gap-2 system-xs-regular">
      <li
        aria-current={!details ? 'step' : undefined}
        className={cn(
          'flex items-center gap-1.5',
          details ? 'text-text-secondary' : 'text-text-primary',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-4 items-center justify-center rounded-full border border-state-accent-hover-alt system-2xs-medium text-text-accent',
            !details && 'bg-util-colors-blue-brand-blue-brand-100',
          )}
        >
          {details ? <span className="i-ri-check-line size-3" /> : '1'}
        </span>
        {t(($) => $['external.connection.step'])}
      </li>
      <li
        aria-hidden
        className={cn('h-px w-5', details ? 'bg-state-accent-hover-alt' : 'bg-divider-subtle')}
      />
      <li
        aria-current={details ? 'step' : undefined}
        className={cn(
          'flex items-center gap-1.5',
          details ? 'font-medium text-text-primary' : 'text-text-tertiary',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-4 items-center justify-center rounded-full border system-2xs-medium',
            details
              ? 'border-state-accent-hover-alt bg-util-colors-blue-brand-blue-brand-100 text-text-accent'
              : 'border-divider-regular text-text-quaternary',
          )}
        >
          2
        </span>
        {t(($) => $['external.connection.details'])}
      </li>
    </ol>
  )
}
