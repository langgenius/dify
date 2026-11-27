import type { FC } from 'react'
import type { NodeProps } from 'reactflow'
import type { DecisionNodeType } from '@/app/components/workflow/nodes/decision/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import InfoPanel from '@/app/components/workflow/nodes/_base/components/info-panel'
import { OTHERWISE_HANDLE_ID } from '@/app/components/workflow/nodes/decision/types'
import { NodeSourceHandle } from '../../node-handle'

const i18nPrefix = 'nodes.decision'

const Node: FC<NodeProps<DecisionNodeType>> = (props) => {
  const { t } = useTranslation(['workflow'])
  const { data } = props
  const { outcomes, otherwise } = data

  return (
    <div className="mb-1 px-3 py-1">
      <div className="mt-2 space-y-0.5">
        {outcomes.map((outcome) => (
          <div key={outcome.id} className="relative">
            <InfoPanel title={outcome.label} content="" />
            <NodeSourceHandle
              {...props}
              handleId={outcome.id}
              handleClassName="top-1/2! -translate-y-1/2! -right-[21px]!"
            />
          </div>
        ))}
        <div className="relative">
          <InfoPanel
            title={
              otherwise.label || t(($) => $[`${i18nPrefix}.otherwiseDefault`], { ns: 'workflow' })
            }
            content=""
          />
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
