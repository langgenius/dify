import {
  binaryTag,
  CORE_SCHEMA,
  loadAll,
  mergeTag,
  omapTag,
  pairsTag,
  setTag,
  timestampTag,
  YAMLException,
} from 'js-yaml'

const YAML_LOAD_SCHEMA = CORE_SCHEMA.withTags(binaryTag, mergeTag, omapTag, pairsTag, setTag, timestampTag)

export function loadYaml(input: string) {
  const documents = loadAll(input, { schema: YAML_LOAD_SCHEMA })
  if (documents.length > 1)
    throw new YAMLException('expected a single document in the stream, but found more')

  return documents[0]
}
