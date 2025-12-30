import type { NodeProps } from 'reactflow'
import { RiHome5Fill } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import { NodeSourceHandle } from '@/app/components/workflow/nodes/_base/components/node-handle'

const IterationStartNode = ({ id, data }: NodeProps) => {
  const { t } = useTranslation()

  return (
    <div className="nodrag group mt-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-workflow-block-border bg-workflow-block-bg shadow-xs">
      <Tooltip popupContent={t('blocks.iteration-start', { ns: 'workflow' })} asChild={false}>
        <div className="flex h-6 w-6 items-center justify-center rounded-full border-[0.5px] border-components-panel-border-subtle bg-util-colors-blue-brand-blue-brand-500">
          <RiHome5Fill className="h-3 w-3 text-text-primary-on-surface" />
        </div>
      </Tooltip>
      <NodeSourceHandle
        id={id}
        data={data}
        handleClassName="!top-1/2 !-right-[9px] !-translate-y-1/2"
        handleId="source"
      />
    </div>
  )
}

export const IterationStartNodeDumb = () => {
  const { t } = useTranslation()

  return (
    <div className="nodrag relative left-[17px] top-[21px] z-[11] flex h-11 w-11 items-center justify-center rounded-2xl border border-workflow-block-border bg-workflow-block-bg">
      <Tooltip popupContent={t('blocks.iteration-start', { ns: 'workflow' })} asChild={false}>
        <div className="flex h-6 w-6 items-center justify-center rounded-full border-[0.5px] border-components-panel-border-subtle bg-util-colors-blue-brand-blue-brand-500">
          <RiHome5Fill className="h-3 w-3 text-text-primary-on-surface" />
        </div>
      </Tooltip>
    </div>
  )
}

export default memo(IterationStartNode)
