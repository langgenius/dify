import { useEffect, useMemo, useRef } from 'react'

type ResettableSchema = {
  variable: string
  reset_on_change?: string[]
}

type UseResetOnChangeOptions<
  Schema extends ResettableSchema,
  Value extends Record<string, unknown>,
> = {
  schemas: Schema[]
  value: Value
  onReset: (schemas: Schema[]) => void
}

const getChangedVariables = (
  previousValue: Record<string, unknown>,
  nextValue: Record<string, unknown>,
) => {
  const variables = new Set([...Object.keys(previousValue), ...Object.keys(nextValue)])
  return new Set(
    [...variables].filter(
      (variable) => JSON.stringify(previousValue[variable]) !== JSON.stringify(nextValue[variable]),
    ),
  )
}

export const useResetOnChange = <
  Schema extends ResettableSchema,
  Value extends Record<string, unknown>,
>({
  schemas,
  value,
  onReset,
}: UseResetOnChangeOptions<Schema, Value>) => {
  const schemaVariablesKey = useMemo(
    () => schemas.map((schema) => schema.variable).join('\0'),
    [schemas],
  )
  const previousValueRef = useRef<Value | null>(null)

  useEffect(() => {
    previousValueRef.current = null
  }, [schemaVariablesKey])

  useEffect(() => {
    const previousValue = previousValueRef.current
    previousValueRef.current = value
    if (!previousValue) return

    const changedVariables = getChangedVariables(previousValue, value)
    if (!changedVariables.size) return

    const schemasToReset = schemas.filter((schema) => {
      const resetOnChange = schema.reset_on_change ?? []
      return (
        resetOnChange.length > 0 &&
        !changedVariables.has(schema.variable) &&
        resetOnChange.some((variable) => changedVariables.has(variable))
      )
    })

    if (schemasToReset.length) onReset(schemasToReset)
  }, [onReset, schemas, value])
}
