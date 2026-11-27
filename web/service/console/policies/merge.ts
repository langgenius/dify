type PolicyTree = { [key: string]: unknown }

function isPolicyTree(value: unknown): value is PolicyTree {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  )
}

function mergeInto(target: PolicyTree, source: PolicyTree, path: string[]) {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (isPolicyTree(current) && isPolicyTree(value)) {
      target[key] = mergeInto({ ...current }, value, [...path, key])
      continue
    }
    if (key in target)
      throw new Error(`Two console policies set ${[...path, key].join('.')}; keep one owner.`)
    target[key] = value
  }
  return target
}

/**
 * Deep-merges policy trees by procedure path. Two trees setting the same option
 * would silently override each other, so that throws instead.
 */
export function mergePolicies<TPolicies extends object>(...trees: TPolicies[]): TPolicies {
  return trees.reduce<PolicyTree>(
    (merged, tree) => mergeInto(merged, tree as PolicyTree, []),
    {},
  ) as TPolicies
}
