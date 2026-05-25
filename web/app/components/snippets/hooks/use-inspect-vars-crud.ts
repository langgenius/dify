import { useInspectVarsCrudCommon } from '../../workflow/hooks/use-inspect-vars-crud-common'
import { useConfigsMap } from './use-configs-map'

export const useInspectVarsCrud = (snippetId: string) => {
  const configsMap = useConfigsMap(snippetId)
  const apis = useInspectVarsCrudCommon({
    ...configsMap,
  })

  return {
    ...apis,
  }
}
