import type { FC } from 'react'
import React from 'react'
import type { HumanInputNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'
// import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
// import { VarBlockIcon } from '@/app/components/workflow/block-icon'
// import { Line3 } from '@/app/components/base/icons/src/public/common'
// import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
// import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
// import { BlockEnum } from '@/app/components/workflow/types'
// import cn from 'classnames'

const Node: FC<NodeProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = getBeforeNodesInSameBranch(id)
  const { getCurrentVariableType } = useWorkflowVariables()
  const isChatMode = useIsChatMode()

  return (
    <div className='mb-1 space-y-0.5 px-3 py-1'>
      TODO
    </div>
  )
}

export default React.memo(Node)
