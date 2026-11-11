import type { ComponentProps } from 'react'
import { PublisherActionsSection } from './actions-section'
import { PublisherSummarySection } from './summary-section'

type BuiltInPublisherProps = {
  actions: ComponentProps<typeof PublisherActionsSection>
  keyboardTarget: ComponentProps<typeof PublisherSummarySection>['keyboardTarget']
  summary: Omit<ComponentProps<typeof PublisherSummarySection>, 'keyboardTarget'>
}

export function BuiltInPublisher({ actions, keyboardTarget, summary }: BuiltInPublisherProps) {
  return (
    <>
      <PublisherSummarySection {...summary} keyboardTarget={keyboardTarget} />
      <PublisherActionsSection {...actions} />
    </>
  )
}
