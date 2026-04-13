import type { AnyObj } from './match-schema-type'
import type { SchemaTypeDefinition } from '@/service/use-common'
import { useSchemaTypeDefinitions } from '@/service/use-common'
import matchTheSchemaType from './match-schema-type'

export const getMatchedSchemaType = (obj: AnyObj, schemaTypeDefinitions?: SchemaTypeDefinition[]): string => {
  if (!schemaTypeDefinitions || obj === undefined || obj === null)
    return ''
  const matched = schemaTypeDefinitions.find(def => matchTheSchemaType(obj, def.schema))
  return matched ? matched.name : ''
}

const useMatchSchemaType = () => {
  const { data: schemaTypeDefinitions, isLoading } = useSchemaTypeDefinitions()

  return {
    isLoading,
    schemaTypeDefinitions,
  }
}

export default useMatchSchemaType
