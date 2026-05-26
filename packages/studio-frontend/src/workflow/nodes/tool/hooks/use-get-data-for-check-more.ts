import type { ToolNodeType } from '../../../nodes/tool/types'
import useConfig from '../../../nodes/tool/hooks/use-config'

type Params = {
  id: string
  payload: ToolNodeType
}

const useGetDataForCheckMore = ({
  id,
  payload,
}: Params) => {
  const { getMoreDataForCheckValid } = useConfig(id, payload)

  return {
    getData: getMoreDataForCheckValid,
  }
}

export default useGetDataForCheckMore
