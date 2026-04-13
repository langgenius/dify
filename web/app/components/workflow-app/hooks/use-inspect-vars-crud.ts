import { useInspectVarsCrudCommon } from '../../workflow/hooks/use-inspect-vars-crud-common'
import { useConfigsMap } from './use-configs-map'

export const useInspectVarsCrud = () => {
  const configsMap = useConfigsMap()
  const apis = useInspectVarsCrudCommon({
    ...configsMap,
  })

  return {
    ...apis,
  }
}
