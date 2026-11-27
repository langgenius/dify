'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SKILL_GRID_CLASS_NAME } from './layout'
const placeholderCardIds = Array.from(
  { length: 16 },
  (_, index) => `skill-placeholder-card-${index}`,
)

export type SkillPlaceholderActions = {
  creating: boolean
  importing: boolean
  onCreate: () => void
  onImport: () => void
}

type SkillPlaceholderStateProps = {
  role?: 'alert' | 'status'
  title: string
} & (
  | { actions?: SkillPlaceholderActions; isRetrying?: never; onRetry?: never }
  | { actions?: never; isRetrying: boolean; onRetry: () => void }
)

export function SkillPlaceholderState({
  actions,
  isRetrying,
  onRetry,
  role,
  title,
}: SkillPlaceholderStateProps) {
  const { t } = useTranslation(['skill'])
  const { t: tCommon } = useTranslation(['common'])

  return (
    <section
      aria-labelledby="skill-placeholder-title"
      className="relative col-span-full min-h-[calc(100vh-142px)] overflow-hidden"
      role={role}
    >
      <div
        className={cn('pointer-events-none absolute inset-0 grid-rows-4', SKILL_GRID_CLASS_NAME)}
      >
        {placeholderCardIds.map((id) => (
          <div key={id} className="rounded-xl bg-background-default-lighter opacity-75" />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-body/0 to-background-body" />
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden px-2 pt-2 pb-16">
        <div className="flex w-130 max-w-full flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-3">
            <div className="flex size-14 items-center justify-center rounded-[10px]">
              <div className="flex size-full min-w-px items-center justify-center overflow-hidden rounded-xl border border-dashed border-divider-regular bg-components-card-bg p-1 backdrop-blur-md">
                <span
                  aria-hidden
                  className="i-custom-vender-agent-v2-building-blocks size-6 text-text-tertiary"
                />
              </div>
            </div>
            <h2
              id="skill-placeholder-title"
              className="system-sm-regular whitespace-nowrap text-text-tertiary"
            >
              {title}
            </h2>
            {onRetry && (
              <Button loading={isRetrying} size="small" variant="secondary" onClick={onRetry}>
                {tCommon(($) => $['operation.retry'])}
              </Button>
            )}
          </div>
          {actions && (
            <div className="flex w-full flex-col gap-2">
              <button
                type="button"
                disabled={actions.creating || actions.importing}
                className="flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl bg-components-button-secondary-bg px-3 py-2.5 text-start outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                onClick={actions.onCreate}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-section">
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 text-text-tertiary',
                      actions.creating ? 'i-ri-loader-4-line animate-spin' : 'i-ri-chat-ai-line',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate system-md-medium text-text-secondary">
                    {t(($) => $['skillManagement.emptyAction.createTitle'])}
                  </span>
                  <span className="block truncate system-xs-regular text-text-tertiary">
                    {t(($) => $['skillManagement.emptyAction.createDescription'])}
                  </span>
                </span>
              </button>
              <button
                type="button"
                disabled={actions.creating || actions.importing}
                className="flex w-full cursor-pointer items-center gap-3 overflow-hidden rounded-xl bg-components-button-secondary-bg px-3 py-2.5 text-start outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50"
                onClick={actions.onImport}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-section">
                  <span
                    aria-hidden
                    className={cn(
                      'size-4 text-text-tertiary',
                      actions.importing ? 'i-ri-loader-4-line animate-spin' : 'i-ri-upload-line',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate system-md-medium text-text-secondary">
                    {t(($) => $['skillManagement.emptyAction.importTitle'])}
                  </span>
                  <span className="block truncate system-xs-regular text-text-tertiary">
                    {t(($) => $['skillManagement.emptyAction.importDescription'])}
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
