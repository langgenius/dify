import type { ComponentProps } from 'react'
import { PublisherActionsSection } from './actions-section'
import { PublisherSummarySection } from './summary-section'

type BuiltInPublisherProps = {
  actions: ComponentProps<typeof PublisherActionsSection>
  summary: ComponentProps<typeof PublisherSummarySection>
}

export function BuiltInPublisher({ actions, summary }: BuiltInPublisherProps) {
  return (
    <>
      <PublisherSummarySection {...summary} />
      <PublisherActionsSection {...actions} />
    </>
  )
}
