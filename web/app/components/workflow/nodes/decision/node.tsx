import type { FC } from 'react'
import type { NodeProps } from 'reactflow'
import type { DecisionNodeType } from './types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { NodeSourceHandle } from '../_base/components/node-handle'
import { DecideBy, OTHERWISE_HANDLE_ID } from './types'

const i18nPrefix = 'nodes.decision'

const Node: FC<NodeProps<DecisionNodeType>> = (props) => {
  const { data } = props
  const { t } = useTranslation(['workflow'])
  const { outcomes, otherwise, decide_by } = data

  const decideByTag =
    decide_by === DecideBy.llm
      ? data.model?.name || t(($) => $[`${i18nPrefix}.decideBy.llm`], { ns: 'workflow' })
      : decide_by === DecideBy.decisionModel
        ? t(($) => $[`${i18nPrefix}.decideBy.decisionModel`], { ns: 'workflow' })
        : t(($) => $[`${i18nPrefix}.decideBy.rules`], { ns: 'workflow' })

  return (
    <div className="mb-1 px-3 py-1">
      <div className="mb-1 inline-flex max-w-full items-center rounded-md bg-workflow-block-parma-bg px-1.25 py-0.5">
        <span
          title={decideByTag}
          className="truncate system-2xs-medium-uppercase text-text-tertiary"
        >
          {decideByTag}
        </span>
      </div>
      <div className="space-y-0.5">
        {outcomes.map((outcome) => (
          <div key={outcome.id} className="relative">
            <div
              className="truncate rounded-md bg-workflow-block-parma-bg px-1.25 py-0.75 system-xs-regular text-text-secondary"
              title={outcome.label}
            >
              {outcome.label || (
                <span className="text-text-quaternary">
                  {t(($) => $[`${i18nPrefix}.outcomePlaceholder`], { ns: 'workflow' })}
                </span>
              )}
            </div>
            <NodeSourceHandle
              {...props}
              handleId={outcome.id}
              handleClassName="top-1/2! -translate-y-1/2! -right-[21px]!"
            />
          </div>
        ))}
        <div className="relative">
          <div className="truncate rounded-md bg-workflow-block-parma-bg px-1.25 py-0.75 system-xs-regular text-text-tertiary">
            {otherwise.label || t(($) => $[`${i18nPrefix}.otherwiseDefault`], { ns: 'workflow' })}
          </div>
          <NodeSourceHandle
            {...props}
            handleId={OTHERWISE_HANDLE_ID}
            handleClassName="top-1/2! -translate-y-1/2! -right-[21px]!"
          />
        </div>
      </div>
    </div>
  )
}

export default React.memo(Node)
