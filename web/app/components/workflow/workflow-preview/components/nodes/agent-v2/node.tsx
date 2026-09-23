import type { NodeProps } from '@/app/components/workflow/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import InfoPanel from '@/app/components/workflow/nodes/_base/components/info-panel'
import { hasAgentV2OutputRoutes } from '@/app/components/workflow/nodes/agent-v2/types'
import { NodeSourceHandle } from '../../node-handle'

const Node = (props: NodeProps) => {
  const { data } = props
  const { t } = useTranslation()

  if (!hasAgentV2OutputRoutes(data)) return null

  return (
    <div className="mb-1 space-y-0.5 px-3 py-1">
      {data.agent_output_routes?.routes?.map((route, index) => (
        <div key={route.id} className="relative">
          <InfoPanel
            title={
              route.label?.trim() ||
              t(($) => $['nodes.agent.outputRoutes.route'], { ns: 'workflow', index: index + 1 })
            }
            content=""
          />
          <NodeSourceHandle
            {...props}
            handleId={route.id}
            handleClassName="top-1/2! -translate-y-1/2! -right-[21px]!"
          />
        </div>
      ))}
    </div>
  )
}

export default memo(Node)
