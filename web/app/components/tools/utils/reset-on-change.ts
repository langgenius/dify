import equal from 'fast-deep-equal'

type ResettableSchema = {
  variable: string
  reset_on_change?: string[]
}

type ApplyResetOnChangeOptions<
  Schema extends ResettableSchema,
  Value extends Record<string, unknown>,
> = {
  schemas: Schema[]
  previousValue: Value
  nextValue: Value
  getResetValue: (schema: Schema, previousValue: unknown) => unknown
}

const getChangedVariables = (
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
) => {
  const variables = new Set([...Object.keys(previousValue), ...Object.keys(nextValue)])
  return new Set(
    [...variables].filter((variable) => !equal(previousValue[variable], nextValue[variable])),
  )
}

export const applyResetOnChange = <
  Schema extends ResettableSchema,
  Value extends Record<string, unknown>,
>({
  schemas,
  previousValue,
  nextValue,
  getResetValue,
}: ApplyResetOnChangeOptions<Schema, Value>): Value => {
  const changedVariables = getChangedVariables(previousValue, nextValue)
  if (!changedVariables.size) return nextValue

  const directlyChangedVariables = new Set(changedVariables)
  const resetVariables = new Set<string>()
  let result: Record<string, unknown> = nextValue
  let hasPendingDependencies = true

  while (hasPendingDependencies) {
    hasPendingDependencies = false

    schemas.forEach((schema) => {
      const resetOnChange = schema.reset_on_change ?? []
      if (
        !resetOnChange.length ||
        directlyChangedVariables.has(schema.variable) ||
        resetVariables.has(schema.variable) ||
        !resetOnChange.some((variable) => changedVariables.has(variable))
      )
        return

      resetVariables.add(schema.variable)
      const resetValue = getResetValue(schema, result[schema.variable])
      if (equal(result[schema.variable], resetValue)) return

      if (result === nextValue) result = { ...nextValue }
      result[schema.variable] = resetValue
      changedVariables.add(schema.variable)
      hasPendingDependencies = true
    })
  }

  return result as Value
}
