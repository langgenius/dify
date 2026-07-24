import type { ToolNodeType } from './types'
import useConfig from './use-config'

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
