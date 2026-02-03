import {
  memo,
} from 'react'

import CandidateNodeMain from './candidate-node-main'
import {
  useStore,
} from './store'

const CandidateNode = () => {
  const candidateNode = useStore(s => s.candidateNode)
  if (!candidateNode)
    return null

  return (
    <CandidateNodeMain candidateNode={candidateNode} />
  )
}

export default memo(CandidateNode)
