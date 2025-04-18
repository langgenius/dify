import type { FC } from 'react'

// import {
//   RiLoader2Line,
//   RiStopCircleFill,
// } from '@remixicon/react'
import { useStore } from '../store'
import cn from '@/utils/classnames'

const Panel: FC = () => {
  const workflowCanvasHeight = useStore(s => s.workflowCanvasHeight)

  return (
    <div className={cn('relative pb-1')}>
    </div>
  )
}

export default Panel
