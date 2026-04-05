export const SubscriptionListMode = {
  PANEL: 'panel',
  SELECTOR: 'selector',
} as const
export type SubscriptionListMode = typeof SubscriptionListMode[keyof typeof SubscriptionListMode]

export type SimpleSubscription = {
  id: string
  name: string
}
