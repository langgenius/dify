'use client'

import { useTranslation } from 'react-i18next'
import {
  RuntimeCredentialBindingsPanel,
} from '@/features/deployments/components/runtime-credential-bindings'
import { TargetBindingSkeleton } from '../skeletons'
import {
  useShouldRenderTargetBindingSection,
  useTargetBindingIsError,
  useTargetBindingIsLoading,
  useTargetBindingSelectAction,
  useTargetBindingSelections,
  useTargetBindingSlots,
} from './section.data'

export function TargetBindingSection() {
  const { t } = useTranslation('deployments')
  const bindingSelections = useTargetBindingSelections()
  const bindingSlots = useTargetBindingSlots()
  const isBindingError = useTargetBindingIsError()
  const isBindingLoading = useTargetBindingIsLoading()
  const onSelectBinding = useTargetBindingSelectAction()
  const shouldRender = useShouldRenderTargetBindingSection()

  if (!shouldRender)
    return null

  if (isBindingLoading || isBindingError) {
    return (
      <div className="overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg">
        <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
          <div className="system-xs-medium-uppercase text-text-tertiary">{t('createGuide.target.bindings')}</div>
          <span className="system-xs-regular text-text-tertiary">{t('createGuide.target.bindingHint')}</span>
        </div>
        {isBindingLoading
          ? <TargetBindingSkeleton />
          : (
              <div className="border-t border-divider-subtle px-3 py-3 system-sm-regular text-text-quaternary">
                {t('createGuide.target.loadBindingsFailed')}
              </div>
            )}
      </div>
    )
  }

  return (
    <RuntimeCredentialBindingsPanel
      slots={bindingSlots}
      selections={bindingSelections}
      title={t('createGuide.target.bindings')}
      hint={t('createGuide.target.bindingHint')}
      noBindingRequiredLabel={t('createGuide.target.noBindingRequired')}
      noCredentialCandidatesLabel={t('createGuide.target.noCredentialCandidates')}
      selectCredentialLabel={t('createGuide.target.selectCredential')}
      missingRequiredLabel={t('createGuide.target.missingRequiredBinding')}
      bindingCountLabel={t('createGuide.target.bindingCount', { count: bindingSlots.length })}
      onChange={onSelectBinding}
      listScrollable={false}
      className="border-components-option-card-option-border bg-components-option-card-option-bg"
    />
  )
}
