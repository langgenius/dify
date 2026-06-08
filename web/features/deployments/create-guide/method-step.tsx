'use client'

import type { GuideMethod } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { RadioRoot } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useTranslation } from 'react-i18next'
import { TitleTooltip } from '../components/title-tooltip'
import { StepShell } from './layout'

function MethodCard({ value, icon, title, description, badge }: {
  value: GuideMethod
  icon: string
  title: string
  description: string
  badge?: string
}) {
  return (
    <RadioRoot<GuideMethod>
      value={value}
      variant="unstyled"
      className={cn(
        `relative box-content h-[84px] w-full cursor-pointer rounded-xl border-[0.5px]
        border-components-option-card-option-border bg-components-panel-on-panel-item-bg p-3
        text-left shadow-xs outline-hidden hover:shadow-md focus-visible:ring-2
        focus-visible:ring-state-accent-solid sm:w-[240px]`,
        'data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:shadow-md data-checked:ring-[0.5px] data-checked:ring-components-option-card-option-selected-border data-checked:ring-inset',
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
        <TitleTooltip content={description}>
          <span className="line-clamp-2 min-w-0 grow system-xs-regular text-text-tertiary">
            {description}
          </span>
        </TitleTooltip>
      </span>
    </RadioRoot>
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
      <RadioGroup<GuideMethod>
        value={method}
        onValueChange={onSelect}
        className="flex flex-col items-stretch gap-2 sm:flex-row"
      >
        <MethodCard
          value="bindApp"
          icon="i-ri-stack-line"
          title={t('createGuide.methods.bindApp.title')}
          description={t('createGuide.methods.bindApp.description')}
        />
        <MethodCard
          value="importDsl"
          icon="i-ri-file-code-line"
          title={t('createGuide.methods.importDsl.title')}
          description={t('createGuide.methods.importDsl.description')}
        />
      </RadioGroup>
    </StepShell>
  )
}
