export const INSTANCE_DETAIL_TAB_KEYS = ['overview', 'instances', 'releases', 'api-tokens'] as const

export type InstanceDetailTabKey = typeof INSTANCE_DETAIL_TAB_KEYS[number]

const INSTANCE_DETAIL_TAB_KEY_SET = new Set<string>(INSTANCE_DETAIL_TAB_KEYS)

export function isInstanceDetailTabKey(value?: string): value is InstanceDetailTabKey {
  return value != null && INSTANCE_DETAIL_TAB_KEY_SET.has(value)
}
