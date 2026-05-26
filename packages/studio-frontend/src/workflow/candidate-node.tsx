import {
  memo,
} from 'react'

import CandidateNodeMain from '@/app/components/workflow/candidate-node-main'
import {
  useStore,
} from '@/app/components/workflow/store/index'

const CandidateNode = () => {
  const candidateNode = useStore(s => s.candidateNode)
  if (!candidateNode)
    return null

  return (
    <CandidateNodeMain candidateNode={candidateNode} />
  )
}

export default memo(CandidateNode)
