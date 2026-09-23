import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { AppTypeIcon, AppTypeLabel } from '../type-selector'

type TemplatePreviewApp = Pick<
  AppPartial,
  'id' | 'name' | 'description' | 'mode' | 'icon' | 'icon_background' | 'author_name'
>

const TEMPLATE_PREVIEW_FIXTURES: { app: TemplatePreviewApp; className: string }[] = [
  {
    app: {
      id: 'trip-budget-planner',
      name: 'Trip Budget Planner',
      description: 'Estimates a day-by-day budget for any itinerary.',
      mode: 'agent-chat',
      icon: '\u{1F916}',
      icon_background: 'var(--color-components-icon-bg-blue-light-soft)',
      author_name: 'Evan',
    },
    className:
      'top-8.25 left-4.5 bg-workflow-block-wrapper-bg-1 motion-safe:group-hover/template:-translate-y-11.5 motion-safe:group-hover/template:-rotate-[3.17deg] motion-safe:group-focus-within/template:-translate-y-11.5 motion-safe:group-focus-within/template:-rotate-[3.17deg]',
  },
  {
    app: {
      id: 'youtube-channel-analysis',
      name: 'YouTube Channel Data Analysis',
      description: 'Pulls channel stats and writes a weekly decision.',
      mode: 'agent-chat',
      icon: '\u{1F4C8}',
      icon_background: 'var(--color-components-icon-bg-pink-soft)',
    },
    className:
      'top-12.5 left-14.5 rotate-[2.9deg] bg-workflow-block-wrapper-bg-1 motion-safe:group-hover/template:-translate-y-6.5 motion-safe:group-hover/template:rotate-[4.29deg] motion-safe:group-focus-within/template:-translate-y-6.5 motion-safe:group-focus-within/template:rotate-[4.29deg]',
  },
  {
    app: {
      id: 'frontend-interviewer',
      name: 'AI Front-end interviewer',
      description: 'Runs a mock front-end interview and scores the answers.',
      mode: 'workflow',
      icon: '\u{1F9B8}\u{1F3FB}',
      icon_background: 'var(--color-components-icon-bg-yellow-soft)',
    },
    className: 'top-15.5 left-0 -rotate-[1.32deg] bg-components-card-bg',
  },
]

function TemplatePreviewCard({ app, className }: (typeof TEMPLATE_PREVIEW_FIXTURES)[number]) {
  return (
    <div
      className={cn(
        'absolute w-[241.5px] overflow-hidden rounded-lg border border-components-card-border pb-2 text-left shadow-xs transition-transform duration-200 ease-out motion-reduce:transition-none',
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
        <div className="relative shrink-0">
          <AppIcon
            size="small"
            iconType="emoji"
            icon={app.icon ?? undefined}
            background={app.icon_background}
            className="size-7 rounded-[7px] text-[16.8px]"
            decorative
          />
          <AppTypeIcon
            type={app.mode}
            wrapperClassName="absolute -right-0.5 -bottom-0.5 size-3 rounded-xs border-components-panel-on-panel-item-bg"
            className="size-2"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <div className="truncate text-[11px]/3.5 font-semibold text-text-secondary">
            {app.name}
          </div>
          {app.author_name ? (
            <div className="text-[8.4px]/[11.2px] text-text-tertiary">{app.author_name}</div>
          ) : (
            <AppTypeLabel
              type={app.mode}
              className="text-[7px]/[11.2px] font-medium text-text-tertiary uppercase"
            />
          )}
        </div>
      </div>
      <div className="px-3 py-1 text-[8.4px]/[11.2px] text-text-tertiary">
        <div className="line-clamp-2 min-h-[22.4px]">{app.description}</div>
      </div>
      <div className="flex gap-1.5 px-3 py-0.5 text-[8.4px]/[11.2px] text-text-tertiary">
        {['Search', 'Productivity'].map((tag) => (
          <span key={tag}>
            <span className="text-text-quaternary"># </span>
            {tag}
          </span>
        ))}
      </div>
    </div>
  )
}

const templatePreview = (
  <div
    aria-hidden
    className="pointer-events-none absolute -top-25 right-2.5 bottom-0 hidden w-80 overflow-hidden select-none md:block"
  >
    <div className="absolute top-12.5 left-0 h-40 w-73.75">
      {TEMPLATE_PREVIEW_FIXTURES.map((fixture) => (
        <TemplatePreviewCard key={fixture.app.id} {...fixture} />
      ))}
    </div>
  </div>
)

export function StarterTemplateEntry({
  disabled,
  onClick,
}: {
  disabled: boolean
  onClick: () => void
}) {
  const { t } = useTranslation(['app'])

  return (
    <div className="group/template relative mx-auto w-160 max-w-[calc(100%-2rem)] shrink-0">
      <button
        type="button"
        disabled={disabled}
        className="flex min-h-20 w-full items-start rounded-t-xl bg-background-body p-4 text-left transition-colors hover:bg-state-base-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid focus-visible:outline-none disabled:pointer-events-none"
        onClick={onClick}
      >
        <span className="flex flex-col gap-1 md:max-w-70">
          <span className="system-md-semibold text-text-primary">
            {t(($) => $['newApp.menu.startFromTemplate'], { ns: 'app' })}
          </span>
          <span className="system-xs-regular text-text-tertiary">
            {t(($) => $['newApp.starter.templateDescription'], { ns: 'app' })}
          </span>
        </span>
      </button>
      {templatePreview}
    </div>
  )
}
