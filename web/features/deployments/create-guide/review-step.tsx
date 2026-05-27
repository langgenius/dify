'use client'

import type {
  CredentialSlot,
} from '@dify/contracts/enterprise/types.gen'
import type { ReactNode } from 'react'
import type { BindingSelections } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  runtimeCredentialCandidateOptions,
  runtimeCredentialSlotKey,
} from '../components/runtime-credential-bindings-utils'
import { StepShell } from './layout'

export function DeploymentSummaryPreview({
  sourceName,
  instanceName,
  releaseName,
  releaseDescription,
  targetEnvironmentName,
  bindingSlots,
  bindingSelections,
}: {
  sourceName: string
  instanceName: string
  releaseName: string
  releaseDescription: string
  targetEnvironmentName: string
  bindingSlots: CredentialSlot[]
  bindingSelections: BindingSelections
}) {
  const { t } = useTranslation('deployments')
  const displayValue = (value: string) => value || '—'
  const sourceDisplayName = displayValue(sourceName)
  const instanceDisplayName = displayValue(instanceName)
  const releaseDisplayName = displayValue(releaseName)
  const environmentDisplayName = displayValue(targetEnvironmentName)
  const routeItems = [
    {
      icon: 'i-ri-apps-2-line',
      label: t('createGuide.review.source'),
      meta: `${t('createGuide.review.instance')} ${instanceDisplayName}`,
      value: sourceDisplayName,
    },
    {
      icon: 'i-ri-price-tag-3-line',
      label: t('createGuide.review.release'),
      value: releaseDisplayName,
    },
    {
      icon: 'i-ri-cloud-line',
      label: t('createGuide.review.environment'),
      value: environmentDisplayName,
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-5 rounded-xl border border-components-panel-border bg-components-panel-bg p-4 sm:p-5">
      <div className="flex flex-col">
        {routeItems.map((item, index) => (
          <div key={item.label} className="flex min-w-0 gap-3">
            <div className="flex w-8 shrink-0 flex-col items-center">
              <span className="flex size-8 items-center justify-center rounded-lg border border-divider-subtle bg-background-default-subtle">
                <span className={cn('size-4 text-text-tertiary', item.icon)} aria-hidden="true" />
              </span>
              {index < routeItems.length - 1 && <span className="my-1 h-5 w-px bg-divider-subtle" aria-hidden="true" />}
            </div>
            <div className="min-w-0 flex-1 pb-3">
              <div className="system-2xs-medium-uppercase text-text-tertiary">{item.label}</div>
              <div className="system-sm-semibold break-words text-text-primary" title={item.value}>{item.value}</div>
              {item.meta && <div className="mt-0.5 system-xs-regular break-words text-text-tertiary" title={item.meta}>{item.meta}</div>}
            </div>
          </div>
        ))}
      </div>
      <div>
        <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.review.bindings')}</div>
        <div className="mt-2 flex flex-col gap-1.5">
          {bindingSlots.length === 0
            ? (
                <div className="rounded-lg bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary">
                  {t('createGuide.target.noBindingRequired')}
                </div>
              )
            : bindingSlots.map((slot) => {
                const slotKey = runtimeCredentialSlotKey(slot)
                const selectedValue = bindingSelections[slotKey] ?? ''
                const selectedCandidate = runtimeCredentialCandidateOptions(slot).find(candidate => candidate.value === selectedValue)
                return (
                  <div key={slotKey} className="grid min-w-0 grid-cols-1 gap-1 rounded-lg bg-background-default-subtle px-3 py-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-2">
                    <span className="system-xs-medium break-words text-text-secondary">{slot.providerId || slotKey}</span>
                    <span className="system-xs-regular break-words text-text-tertiary sm:text-right">{selectedCandidate?.label || '—'}</span>
                  </div>
                )
              })}
        </div>
      </div>
      <div>
        <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.review.releaseNote')}</div>
        <div className="mt-1 line-clamp-3 system-xs-regular whitespace-pre-wrap text-text-secondary">{releaseDescription || '—'}</div>
      </div>
    </div>
  )
}

export function ReviewStep({
  preview,
}: {
  preview: ReactNode
}) {
  const { t } = useTranslation('deployments')

  return (
    <StepShell
      title={t('createGuide.review.title')}
      description={t('createGuide.review.description')}
    >
      {preview}
    </StepShell>
  )
}
