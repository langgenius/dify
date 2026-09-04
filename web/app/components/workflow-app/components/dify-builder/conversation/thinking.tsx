import type { Trace } from '@dify/contracts/api/console/dify-builder/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'

export const Thinking = ({ trace }: { trace?: Trace }) => {
  const { t } = useTranslation()
  const steps = trace?.steps ?? []
  const activeStep = steps.find((step) => step.state === 'active')

  return (
    <details className="group min-h-8" open={steps.some((step) => step.state === 'active')}>
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 text-[13px] leading-4 font-medium text-text-tertiary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid">
        <span aria-hidden className="i-custom-public-app-builder-thinking size-[18px] shrink-0" />
        <span>{t(($) => $['difyBuilder.thinking'], { ns: 'workflow' })}</span>
        <span className="grow" />
        {steps.length > 0 && (
          <span
            aria-hidden
            className="i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform group-open:rotate-90"
          />
        )}
      </summary>
      {activeStep ? (
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {activeStep.label}
        </span>
      ) : null}
      {steps.length > 0 && (
        <ol className="ml-5 space-y-1 border-l border-divider-subtle py-1 pl-3 text-xs text-text-tertiary">
          {steps.map((step) => (
            <li key={step.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn(
                  'size-1.5 rounded-full bg-text-quaternary',
                  step.state === 'active' &&
                    'animate-pulse bg-text-accent motion-reduce:animate-none',
                  step.state === 'done' && 'bg-text-success',
                  step.state === 'stopped' && step.tone === 'error' && 'bg-state-destructive-solid',
                )}
              />
              <span>{step.label}</span>
            </li>
          ))}
        </ol>
      )}
    </details>
  )
}
