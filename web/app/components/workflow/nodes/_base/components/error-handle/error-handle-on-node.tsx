import { NodeSourceHandle } from '../node-handle'
import { ErrorHandleTypeEnum } from './types'
import type { Node } from '@/app/components/workflow/types'

type ErrorHandleOnNodeProps = Pick<Node, 'id' | 'data'>
const ErrorHandleOnNode = ({
  id,
  data,
}: ErrorHandleOnNodeProps) => {
  const { error_strategy } = data

  if (!error_strategy)
    return null

  return (
    <div className='relative pt-1 pb-2 px-3'>
      <div className='relative flex items-center justify-between px-[5px] h-6 bg-workflow-block-parma-bg rounded-md'>
        <div className='system-xs-medium-uppercase text-text-tertiary'>on failure</div>
        <div className='system-xs-medium text-text-secondary'>
          {
            error_strategy === ErrorHandleTypeEnum.defaultValue && (
              'Output Default Value'
            )
          }
          {
            error_strategy === ErrorHandleTypeEnum.failBranch && (
              'Fail Branch'
            )
          }
        </div>
        {
          error_strategy === ErrorHandleTypeEnum.failBranch && (
            <NodeSourceHandle
              id={id}
              data={data}
              handleId='source'
              handleClassName='!top-1/2 !-right-[21px] !-translate-y-1/2 !after:bg-workflow-link-line-failure-button-bg'
              nodeSelectorClassName='!bg-workflow-link-line-failure-button-bg'
            />
          )
        }
      </div>
    </div>
  )
}

export default ErrorHandleOnNode
