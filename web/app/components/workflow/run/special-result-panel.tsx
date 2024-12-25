import RetryResultPanel from './retry-result-panel'
import IterationResultPanel from './iteration-result-panel'
import type { IterationDurationMap, NodeTracing } from '@/types/workflow'

type SpecialResultPanelProps = {
  showRetryDetail: boolean
  setShowRetryDetailFalse: () => void
  retryResultList: NodeTracing[]

  showIteratingDetail: boolean
  setShowIteratingDetailFalse: () => void
  iterationResultList: NodeTracing[][]
  iterationResultDurationMap: IterationDurationMap
}
const SpecialResultPanel = ({
  showRetryDetail,
  setShowRetryDetailFalse,
  retryResultList,

  showIteratingDetail,
  setShowIteratingDetailFalse,
  iterationResultList,
  iterationResultDurationMap,
}: SpecialResultPanelProps) => {
  return (
    <>
      {
        showRetryDetail && (
          <RetryResultPanel
            list={retryResultList}
            onBack={setShowRetryDetailFalse}
          />
        )
      }
      {
        showIteratingDetail && (
          <IterationResultPanel
            list={iterationResultList}
            onHide={setShowIteratingDetailFalse}
            onBack={setShowIteratingDetailFalse}
            iterDurationMap={iterationResultDurationMap}
          />
        )
      }
    </>
  )
}

export default SpecialResultPanel
