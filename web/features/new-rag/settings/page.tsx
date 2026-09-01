'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { CapabilityReturnController } from './capability-return-controller'
import { KnowledgeSettingsForm } from './form'
import { KnowledgeSettingsStateBoundary } from './state/boundary'
import {
  knowledgeSettingsHasErrorAtom,
  knowledgeSettingsIsPendingAtom,
  knowledgeSettingsSettingsAtom,
  knowledgeSettingsSpaceAtom,
  retryKnowledgeSettingsAtom,
} from './state/queries'

function KnowledgeSettingsSkeleton() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')

  return (
    <div className="flex flex-col gap-4 pt-2">
      <span className="sr-only" role="status">
        {tCommon(($) => $.loading)}
      </span>
      <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
        {t(($) => $['newKnowledge.settings.basicInfo'])}
      </h2>
      {[
        tSettings(($) => $['form.nameAndIcon']),
        tSettings(($) => $['form.desc']),
        tSettings(($) => $['form.permissions']),
      ].map((label) => (
        <div key={label} className="flex gap-1">
          <div className="flex h-7 w-45 items-center system-sm-semibold text-text-secondary">
            {label}
          </div>
          <SkeletonRectangle className="h-9 flex-1 rounded-lg" />
        </div>
      ))}
      <div className="h-px bg-divider-subtle" />
      <div className="flex gap-1">
        <div className="w-45 shrink-0">
          <h2 className="flex h-8 items-center system-sm-semibold text-text-secondary">
            {t(($) => $['newKnowledge.settings.retrievalTitle'])}
          </h2>
          <p className="body-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.settings.retrievalDescription'])}
          </p>
        </div>
        <SkeletonRectangle className="h-64 flex-1 rounded-lg" />
      </div>
      <div className="h-px bg-divider-subtle" />
      <div className="flex gap-1 pt-7">
        <h2 className="flex h-8 w-45 items-center system-sm-semibold text-text-destructive">
          {t(($) => $['newKnowledge.settings.dangerZone'])}
        </h2>
        <SkeletonRectangle className="h-16 flex-1 rounded-xl" />
      </div>
    </div>
  )
}

function KnowledgeSettingsContent() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tSettings } = useTranslation('datasetSettings')
  const isPending = useAtomValue(knowledgeSettingsIsPendingAtom)
  const hasError = useAtomValue(knowledgeSettingsHasErrorAtom)
  const space = useAtomValue(knowledgeSettingsSpaceAtom)
  const settings = useAtomValue(knowledgeSettingsSettingsAtom)
  const retry = useSetAtom(retryKnowledgeSettingsAtom)

  return (
    <div className="min-h-full w-full overflow-y-auto px-6 pt-3 pb-6">
      <CapabilityReturnController />
      <div className="flex flex-col gap-0.5">
        <h1 className="system-xl-semibold text-text-primary">{tSettings(($) => $.title)}</h1>
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.settings.pageDescription'])}
        </p>
      </div>

      <div className="mt-3 w-full max-w-196">
        {isPending && <KnowledgeSettingsSkeleton />}
        {!isPending && hasError && (
          <div
            className="flex items-center gap-3 rounded-xl border border-components-panel-border bg-background-section p-4"
            role="alert"
          >
            <span aria-hidden className="i-ri-error-warning-line size-5 text-text-destructive" />
            <p className="min-w-0 flex-1 system-sm-regular text-text-secondary">
              {tCommon(($) => $['api.actionFailed'])}
            </p>
            <Button onClick={() => void retry()}>{tCommon(($) => $['operation.retry'])}</Button>
          </div>
        )}
        {!isPending && !hasError && space && settings && <KnowledgeSettingsForm />}
      </div>
    </div>
  )
}

export function KnowledgeSettingsPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  return (
    <KnowledgeSettingsStateBoundary knowledgeSpaceId={knowledgeSpaceId}>
      <KnowledgeSettingsContent />
    </KnowledgeSettingsStateBoundary>
  )
}
