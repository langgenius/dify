'use client'

import type { GuideMethod } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { StepShell } from './layout'

function MethodCard({ icon, title, description, badge, selected, onClick }: {
  icon: string
  title: string
  description: string
  badge?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        `relative box-content h-[84px] w-full cursor-pointer rounded-xl border-[0.5px]
        border-components-option-card-option-border bg-components-panel-on-panel-item-bg p-3
        text-left shadow-xs hover:shadow-md sm:w-[191px]`,
        selected && 'shadow-md outline-[1.5px] outline-components-option-card-option-selected-border outline-solid',
      )}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-divider-subtle bg-background-default-subtle">
        <span className={cn('size-4 text-text-tertiary', icon)} aria-hidden="true" />
      </span>
      <span className="mt-2 mb-0.5 flex min-w-0 items-center gap-1">
        <span className="truncate system-sm-semibold text-text-secondary">{title}</span>
        {badge && (
          <span className="shrink-0 rounded-md bg-background-default-subtle px-1.5 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
            {badge}
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-start gap-1">
        <span className="line-clamp-2 min-w-0 grow system-xs-regular text-text-tertiary" title={description}>
          {description}
        </span>
      </span>
    </button>
  )
}

export function MethodStep({ method, onSelect }: {
  method?: GuideMethod
  onSelect: (method: GuideMethod) => void
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.steps.method')}
      description={t('createGuide.method.description')}
      descriptionClassName="lg:hidden"
      hideHeader
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <MethodCard
          icon="i-ri-stack-line"
          title={t('createGuide.methods.bindApp.title')}
          description={t('createGuide.methods.bindApp.description')}
          selected={method === 'bindApp'}
          onClick={() => onSelect('bindApp')}
        />
        <MethodCard
          icon="i-ri-file-code-line"
          title={t('createGuide.methods.importDsl.title')}
          description={t('createGuide.methods.importDsl.description')}
          selected={method === 'importDsl'}
          onClick={() => onSelect('importDsl')}
        />
      </div>
    </StepShell>
  )
}
