import type { NodeTracing } from '@/types/workflow'
import { useMemo } from 'react'
import formatTracing from '@/app/components/workflow/run/utils/format-log'
import { useTranslation } from 'react-i18next'

type Params = {
  runResult: NodeTracing
  loopRunResult: NodeTracing[]
}

const useSingleRunFormParams = ({
  runResult,
  loopRunResult,
}: Params) => {
  const { t } = useTranslation()
  const nodeInfo = useMemo(() => {
    const formattedNodeInfo = formatTracing(loopRunResult, t)[0]

    if (runResult && formattedNodeInfo) {
      return {
        ...formattedNodeInfo,
        execution_metadata: {
          ...runResult.execution_metadata,
          ...formattedNodeInfo.execution_metadata,
        },
      }
    }

    return formattedNodeInfo
  }, [runResult, loopRunResult, t])
  return {
    forms: [],
    nodeInfo,
  }
}

export default useSingleRunFormParams
