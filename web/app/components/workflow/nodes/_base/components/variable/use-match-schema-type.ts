import type { AnyObj } from './match-schema-type'
import type { SchemaTypeDefinition } from '@/service/use-common'
import { useQuery } from '@tanstack/react-query'
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

const useMatchSchemaType = () => {
  const { data: schemaTypeDefinitions, isLoading } = useQuery(
    consoleQuery.spec.schemaDefinitions.get.queryOptions(),
  )

  return {
    isLoading,
    schemaTypeDefinitions,
  }
}

export default useMatchSchemaType
