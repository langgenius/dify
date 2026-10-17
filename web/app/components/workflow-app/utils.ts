type TriggerStatusLike = {
  node_id: string
  status: string
}

export const buildTriggerStatusMap = (triggers: TriggerStatusLike[]) => {
  return triggers.reduce<Record<string, 'enabled' | 'disabled'>>((acc, trigger) => {
    acc[trigger.node_id] = trigger.status === 'enabled' ? 'enabled' : 'disabled'
    return acc
  }, {})
}

export const coerceReplayUserInputs = (
  rawInputs: unknown,
): Record<string, string | number | boolean> | null => {
  if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) return null

  const userInputs: Record<string, string | number | boolean> = {}

  Object.entries(rawInputs as Record<string, unknown>).forEach(([key, value]) => {
    if (key.startsWith('sys.')) return

    if (value == null) {
      userInputs[key] = ''
      return
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      userInputs[key] = value
      return
    }

    try {
      userInputs[key] = JSON.stringify(value)
    } catch {
      userInputs[key] = String(value)
    }
  })

  return userInputs
}
