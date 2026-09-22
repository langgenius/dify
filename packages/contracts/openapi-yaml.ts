import {
  binaryTag,
  CORE_SCHEMA,
  load,
  mergeTag,
  omapTag,
  pairsTag,
  setTag,
  timestampTag,
} from 'js-yaml'

const OPENAPI_YAML_SCHEMA = CORE_SCHEMA.withTags(
  binaryTag,
  mergeTag,
  omapTag,
  pairsTag,
  setTag,
  timestampTag,
)

export function loadOpenApiYaml(input: string) {
  return load(input, { schema: OPENAPI_YAML_SCHEMA })
}
