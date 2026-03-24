import type { TFunction } from 'i18next'
import type { ReactElement } from 'react'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import type { NodeProps } from '@/app/components/workflow/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'

type HeaderMetaProps = {
  data: NodeProps['data']
  hasVarValue: boolean
  isLoading: boolean
  loopIndex: ReactElement | null
  t: TFunction
}

export const NodeHeaderMeta = ({
  data,
  hasVarValue,
  isLoading,
  loopIndex,
  t,
}: HeaderMetaProps) => {
  return (
    <>
      {data.type === BlockEnum.Iteration && (data as IterationNodeType).is_parallel && (
        <Tooltip>
          <TooltipTrigger>
            <div className="ml-1 flex items-center justify-center rounded-[5px] border-[1px] border-text-warning px-[5px] py-[3px] text-text-warning system-2xs-medium-uppercase">
              {t('nodes.iteration.parallelModeUpper', { ns: 'workflow' })}
            </div>
          </TooltipTrigger>
          <TooltipContent popupClassName="w-[180px]">
            <div className="font-extrabold">
              {t('nodes.iteration.parallelModeEnableTitle', { ns: 'workflow' })}
            </div>
            {t('nodes.iteration.parallelModeEnableDesc', { ns: 'workflow' })}
          </TooltipContent>
        </Tooltip>
      )}
      {!!(data._iterationLength && data._iterationIndex && data._runningStatus === NodeRunningStatus.Running) && (
        <div className="mr-1.5 text-xs font-medium text-text-accent">
          {data._iterationIndex > data._iterationLength ? data._iterationLength : data._iterationIndex}
          /
          {data._iterationLength}
        </div>
      )}
      {!!(data.type === BlockEnum.Loop && data._loopIndex) && loopIndex}
      {isLoading && <span className="i-ri-loader-2-line h-3.5 w-3.5 animate-spin text-text-accent" />}
      {!isLoading && data._runningStatus === NodeRunningStatus.Failed && (
        <span className="i-ri-error-warning-fill h-3.5 w-3.5 text-text-destructive" />
      )}
      {!isLoading && data._runningStatus === NodeRunningStatus.Exception && (
        <span className="i-ri-alert-fill h-3.5 w-3.5 text-text-warning-secondary" />
      )}
      {!isLoading && (data._runningStatus === NodeRunningStatus.Succeeded || (!data._runningStatus && hasVarValue)) && (
        <span className="i-ri-checkbox-circle-fill h-3.5 w-3.5 text-text-success" />
      )}
      {!isLoading && data._runningStatus === NodeRunningStatus.Paused && (
        <span className="i-ri-pause-circle-fill h-3.5 w-3.5 text-text-warning-secondary" />
      )}
    </>
  )
}

type NodeBodyProps = {
  data: NodeProps['data']
  child: ReactElement
}

export const NodeBody = ({
  data,
  child,
}: NodeBodyProps) => {
  if (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) {
    return (
      <div className="grow pb-1 pl-1 pr-1">
        {child}
      </div>
    )
  }

  return child
}

export const NodeDescription = ({ data }: { data: NodeProps['data'] }) => {
  if (!data.desc || data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop)
    return null

  return (
    <div className="whitespace-pre-line break-words px-3 pb-2 pt-1 text-text-tertiary system-xs-regular">
      {data.desc}
    </div>
  )
}
