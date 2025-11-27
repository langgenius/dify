import {
  memo,
} from 'react'

import {
  useStore,
} from './store'
import CandidateNodeMain from './candidate-node-main'

const CandidateNode = () => {
  const candidateNode = useStore(s => s.candidateNode)
  if (!candidateNode)
    return null

  return (
    <CandidateNodeMain candidateNode={candidateNode} />
  )
}

export default memo(CandidateNode)
