import type { SchemaDefinitionItemResponse } from '@dify/contracts/api/console/spec/types.gen'
import type { AnyObj } from './match-schema-type'
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'
import matchTheSchemaType from './match-schema-type'

export const getMatchedSchemaType = (
  obj: AnyObj,
  schemaTypeDefinitions?: SchemaDefinitionItemResponse[],
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
