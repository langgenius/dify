import type { NodeProps } from 'reactflow'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiHome5Fill } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeSourceHandle } from '../../node-handle'

const IterationStartNode = ({ id, data }: NodeProps) => {
  const { t } = useTranslation()

  return (
    <div className="nodrag group mt-1 flex h-11 w-11 items-center justify-center rounded-2xl border border-workflow-block-border bg-workflow-block-bg shadow-xs">
      <Tooltip>
        <TooltipTrigger
          aria-label={t('blocks.iteration-start', { ns: 'workflow' })}
          className="flex h-6 w-6 items-center justify-center rounded-full border-[0.5px] border-components-panel-border-subtle bg-util-colors-blue-brand-blue-brand-500 p-0"
        >
          <RiHome5Fill className="h-3 w-3 text-text-primary-on-surface" />
        </TooltipTrigger>
        <TooltipContent>{t('blocks.iteration-start', { ns: 'workflow' })}</TooltipContent>
      </Tooltip>
      <NodeSourceHandle
        id={id}
        data={data}
        handleClassName="top-1/2! -right-[9px]! -translate-y-1/2!"
        handleId="source"
      />
    </div>
  )
}

export default memo(IterationStartNode)
