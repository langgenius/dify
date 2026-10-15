import type { AnyObj } from './match-schema-type'
import type { SchemaTypeDefinition } from '@/service/use-common'
import { useQuery } from '@tanstack/react-query'
import { isPlainObject } from 'es-toolkit/predicate'
import { consoleQuery } from '@/service/console'
import matchTheSchemaType from './match-schema-type'

export const getMatchedSchemaType = (
  obj: AnyObj,
  schemaTypeDefinitions?: SchemaTypeDefinition[],
): string => {
  if (!schemaTypeDefinitions || obj === undefined || obj === null) return ''
  const matched = schemaTypeDefinitions.find((def) => matchTheSchemaType(obj, def.schema))
  return matched ? matched.name : ''
}

// Definition schemas are untyped JSON in the console API response.
const toSchemaTypeDefinitions = (
  definitions: Array<{ name: string; schema: Record<string, unknown> }>,
): SchemaTypeDefinition[] =>
  definitions.map(({ name, schema }) => ({
    name,
    schema: {
      properties: isPlainObject(schema.properties)
        ? (schema.properties as Record<string, unknown>)
        : {},
    },
  }))

const useMatchSchemaType = () => {
  const { data: schemaTypeDefinitions, isLoading } = useQuery(
    consoleQuery.spec.schemaDefinitions.get.queryOptions({ select: toSchemaTypeDefinitions }),
  )

  return {
    isLoading,
    schemaTypeDefinitions,
  }
}

export default useMatchSchemaType
