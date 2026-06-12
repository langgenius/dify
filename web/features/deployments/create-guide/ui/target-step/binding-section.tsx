'use client'

import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  RuntimeCredentialBindingsPanel,
} from '@/features/deployments/components/runtime-credential-bindings'
import {
  deploymentOptionsQueryAtom,
  deploymentTargetBindingSelectionsAtom,
  deploymentTargetBindingSlotsAtom,
  selectBindingAtom,
  unsupportedDslNodesAtom,
} from '@/features/deployments/create-guide/state'
import { TargetBindingSkeleton } from './skeletons'

export function TargetBindingSection() {
  const { t } = useTranslation('deployments')
  const deploymentOptionsQuery = useAtomValue(deploymentOptionsQueryAtom)
  const bindingSlots = useAtomValue(deploymentTargetBindingSlotsAtom)
  const bindingSelections = useAtomValue(deploymentTargetBindingSelectionsAtom)
  const isBindingError = deploymentOptionsQuery.isError
  const isBindingLoading = deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data)
  const selectBinding = useSetAtom(selectBindingAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)
  const shouldRender = !(isBindingError && unsupportedDslNodes.length > 0)

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
      onChange={selectBinding}
      listScrollable={false}
      className="border-components-option-card-option-border bg-components-option-card-option-bg"
    />
  )
}
