import { useSchemaTypeDefinitions } from '@/service/use-common'
import type { AnyObj } from './match-schema-type'
import matchTheSchemaType from './match-schema-type'

const useMatchSchemaType = () => {
  const { data: schemaTypeDefinitions } = useSchemaTypeDefinitions()
  const getMatchedSchemaType = (obj: AnyObj): string => {
    if(!schemaTypeDefinitions) return ''
    const matched = schemaTypeDefinitions.find(def => matchTheSchemaType(obj, def.schema))
    return matched ? matched.name : ''
  }
  return {
    getMatchedSchemaType,
  }
}

export default useMatchSchemaType
