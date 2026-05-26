import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import useConfig from '@/app/components/workflow/nodes/tool/hooks/use-config'

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
