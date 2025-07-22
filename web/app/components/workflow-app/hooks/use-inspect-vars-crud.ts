import { useStore } from '@/app/components/workflow/store'
import { useInspectVarsCrudCommon } from '../../workflow/hooks/use-inspect-vars-crud-common'
import { useConfigsMap } from './use-configs-map'

export const useInspectVarsCrud = () => {
  const appId = useStore(s => s.appId)
  const configsMap = useConfigsMap()
  const apis = useInspectVarsCrudCommon({
    flowId: appId,
    ...configsMap,
  })

  return {
    ...apis,
  }
}
