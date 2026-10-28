import type { PlanCard as PlanCardPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import { useTranslation } from 'react-i18next'
import { DifyBuilderCard } from '../cards/card-shell'
import { useBuilderText } from '../copy/use-builder-text'

export const PlanCard = ({
  payload,
  invalidated,
}: {
  payload: PlanCardPayload
  invalidated: boolean
}) => {
  const { locale, renderText } = useBuilderText(payload.reply_language)
  const { t } = useTranslation(['difyBuilder'], { lng: locale })
  const items = payload.items ?? []

  return (
    <DifyBuilderCard
      category={t(($) => $['cardCategory.plan'], { ns: 'difyBuilder' })}
      headline={renderText(payload.title)}
      invalidated={invalidated}
      className="rounded-[10px]"
      bodyClassName="pt-1"
      meta={t(($) => $['plan.stepCount'], { ns: 'difyBuilder', count: items.length })}
      status={
        invalidated
          ? undefined
          : {
              state: 'waiting',
              label: t(($) => $['plan.ready'], { ns: 'difyBuilder' }),
              icon: (
                <span aria-hidden className="flex size-4 shrink-0 items-center justify-center">
                  <span className="i-ri-hourglass-2-fill size-3.5" />
                </span>
              ),
            }
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <dl className="divide-y divide-divider-subtle rounded-lg bg-background-section px-2">
          <div className="flex items-baseline gap-3 py-2">
            <dt className="w-11 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['plan.input'], { ns: 'difyBuilder' })}
            </dt>
            <dd className="min-w-0 flex-1 system-sm-regular wrap-anywhere whitespace-pre-wrap text-text-primary">
              {payload.input_summary}
            </dd>
          </div>
          <div className="flex items-baseline gap-3 py-2">
            <dt className="w-11 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['plan.output'], { ns: 'difyBuilder' })}
            </dt>
            <dd className="min-w-0 flex-1 system-sm-regular wrap-anywhere whitespace-pre-wrap text-text-primary">
              {payload.output_summary}
            </dd>
          </div>
        </dl>
        {items.length > 0 && (
          <ol className="flex flex-col">
            {items.map((text, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- Plan steps are ordered strings without IDs; the position distinguishes repeated text.
              <li key={`${index}:${text}`} className="flex items-start gap-2 py-1">
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-md bg-components-badge-bg-gray-soft system-2xs-semibold-uppercase text-text-tertiary"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 system-sm-regular wrap-anywhere text-text-primary">
                  {text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </DifyBuilderCard>
  )
}
