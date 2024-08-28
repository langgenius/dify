import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { NodeProps } from 'reactflow'
import { RiHome5Fill } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { NodeSourceHandle } from '@/app/components/workflow/nodes/_base/components/node-handle'

const IterationStartNode = ({ id, data }: NodeProps) => {
  const { t } = useTranslation()

  return (
    <div className='group flex nodrag items-center justify-center w-11 h-11 rounded-2xl border border-workflow-block-border bg-white'>
      <Tooltip popupContent={t('workflow.blocks.iteration-start')} asChild={false}>
        <div className='flex items-center justify-center w-6 h-6 rounded-full border-[0.5px] border-components-panel-border-subtle bg-util-colors-blue-brand-blue-brand-500'>
          <RiHome5Fill className='w-3 h-3 text-text-primary-on-surface' />
        </div>
      </Tooltip>
      <NodeSourceHandle
        id={id}
        data={data}
        handleClassName='!top-1/2 !-right-[9px] !-translate-y-1/2'
        handleId='source'
      />
    </div>
  )
}

export const IterationStartNodeDumb = () => {
  const { t } = useTranslation()

  return (
    <div className='relative left-[17px] top-[21px] flex nodrag items-center justify-center w-11 h-11 rounded-2xl border border-workflow-block-border bg-white z-[11]'>
      <Tooltip popupContent={t('workflow.blocks.iteration-start')} asChild={false}>
        <div className='flex items-center justify-center w-6 h-6 rounded-full border-[0.5px] border-components-panel-border-subtle bg-util-colors-blue-brand-blue-brand-500'>
          <RiHome5Fill className='w-3 h-3 text-text-primary-on-surface' />
        </div>
      </Tooltip>
    </div>
  )
}

export default memo(IterationStartNode)
