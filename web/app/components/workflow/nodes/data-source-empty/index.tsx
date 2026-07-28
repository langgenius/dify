import type { NodeProps } from 'reactflow'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import BlockSelector from '@/app/components/workflow/block-selector'
import { TabType } from '@/app/components/workflow/block-selector/types'
import { useReplaceDataSourceNode } from './hooks'

const DataSourceEmptyNode = ({ id, data }: NodeProps) => {
  const { t } = useTranslation()
  const { handleReplaceNode } = useReplaceDataSourceNode(id)

  const renderTrigger = useCallback(() => {
    return (
      <Button variant="primary" className="w-full">
        <span aria-hidden className="mr-1 i-ri-add-line size-4" />
        {t(($) => $['nodes.dataSource.add'], { ns: 'workflow' })}
      </Button>
    )
  }, [t])

  return (
    <div
      className={cn('relative flex rounded-2xl border', 'border-transparent')}
      style={{
        width: data.width,
        height: data.height,
      }}
    >
      <div className="absolute inset-[-2px] top-[-22px] z-[-1] rounded-[18px] bg-node-data-source-bg p-0.5 backdrop-blur-[6px]">
        <div className="flex h-5 items-center px-2.5 system-2xs-semibold-uppercase text-text-tertiary">
          {t(($) => $['blocks.datasource'], { ns: 'workflow' })}
        </div>
      </div>
      <div
        className={cn(
          'group relative shadow-xs',
          'rounded-[15px] border border-transparent',
          'w-[240px] bg-workflow-block-bg',
        )}
      >
        <div className={cn('flex items-center rounded-t-2xl p-3')}>
          <BlockSelector
            onSelect={handleReplaceNode}
            trigger={renderTrigger}
            standalonePanel={TabType.Sources}
            popupClassName="w-[320px]"
            placement="bottom-start"
            sideOffset={4}
          />
        </div>
      </div>
    </div>
  )
}

export default memo(DataSourceEmptyNode)
