import type {
  ReactElement,
} from 'react'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import type {
  NodeProps,
} from '@/app/components/workflow/types'
import {
  cloneElement,
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import {
  BlockEnum,
} from '@/app/components/workflow/types'
import { hasErrorHandleNode } from '@/app/components/workflow/utils'
import { cn } from '@/utils/classnames'
import ErrorHandleOnNode from '../error-handle-on-node'
import {
  NodeSourceHandle,
  NodeTargetHandle,
} from '../node-handle'

type NodeChildElement = ReactElement<Partial<NodeProps>>

type NodeCardProps = NodeProps & {
  children?: NodeChildElement
}

const BaseCard = ({
  id,
  data,
  children,
}: NodeCardProps) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'flex rounded-2xl border-[2px] border-transparent',
      )}
      style={{
        width: (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) ? data.width : 'auto',
        height: (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) ? data.height : 'auto',
      }}
    >
      <div
        className={cn(
          'group relative pb-1 shadow-xs',
          'rounded-[15px] border border-transparent',
          'bg-workflow-block-bg hover:shadow-lg',
        )}
        style={{
          width: (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) ? data.width : '240px',
          height: (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) ? data.height : 'auto',
        }}
      >
        <div className={cn(
          'flex items-center rounded-t-2xl px-3 pb-2 pt-3',
        )}
        >
          <NodeTargetHandle
            id={id}
            data={data}
            handleClassName="!top-4 !-left-[9px] !translate-y-0"
            handleId="target"
          />
          {
            data.type !== BlockEnum.IfElse && data.type !== BlockEnum.QuestionClassifier && (
              <NodeSourceHandle
                id={id}
                data={data}
                handleClassName="!top-4 !-right-[9px] !translate-y-0"
                handleId="source"
              />
            )
          }
          <BlockIcon
            className="mr-2 shrink-0"
            type={data.type}
            size="md"
          />
          <div
            title={data.title}
            className="system-sm-semibold-uppercase mr-1 flex grow items-center truncate text-text-primary"
          >
            <div>
              {data.title}
            </div>
            {
              data.type === BlockEnum.Iteration && (data as IterationNodeType).is_parallel && (
                <Tooltip popupContent={(
                  <div className="w-[180px]">
                    <div className="font-extrabold">
                      {t('nodes.iteration.parallelModeEnableTitle', { ns: 'workflow' })}
                    </div>
                    {t('nodes.iteration.parallelModeEnableDesc', { ns: 'workflow' })}
                  </div>
                )}
                >
                  <div className="system-2xs-medium-uppercase ml-1 flex items-center justify-center rounded-[5px] border-[1px] border-text-warning px-[5px] py-[3px] text-text-warning ">
                    {t('nodes.iteration.parallelModeUpper', { ns: 'workflow' })}
                  </div>
                </Tooltip>
              )
            }
          </div>
        </div>
        {
          data.type !== BlockEnum.Iteration && data.type !== BlockEnum.Loop && children && (
            cloneElement(children, { id, data })
          )
        }
        {
          (data.type === BlockEnum.Iteration || data.type === BlockEnum.Loop) && children && (
            <div className="h-[calc(100%-42px)] w-full grow pb-1 pl-1 pr-1">
              {cloneElement(children, { id, data })}
            </div>
          )
        }
        {
          hasErrorHandleNode(data.type) && (
            <ErrorHandleOnNode
              id={id}
              data={data}
            />
          )
        }
        {
          data.desc && data.type !== BlockEnum.Iteration && data.type !== BlockEnum.Loop && (
            <div className="system-xs-regular whitespace-pre-line break-words px-3 pb-2 pt-1 text-text-tertiary">
              {data.desc}
            </div>
          )
        }
      </div>
    </div>
  )
}

export default memo(BaseCard)
