import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { Icon3Dots } from '@/app/components/base/icons/src/vender/line/others'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useToolIcon } from '@/app/components/workflow/hooks'
import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { BlockEnum } from '@/app/components/workflow/types'

type ConnectProps = {
  nodeData: DataSourceNodeType
  onSetting: () => void
}

const Connect = ({
  nodeData,
  onSetting,
}: ConnectProps) => {
  const { t } = useTranslation()
  const toolIcon = useToolIcon(nodeData)

  return (
    <div className='flex flex-col items-start gap-y-2 rounded-xl bg-workflow-process-bg p-6'>
      <div className='flex size-12 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg p-1 shadow-lg shadow-shadow-shadow-5'>
        <BlockIcon
          type={BlockEnum.DataSource}
          toolIcon={toolIcon}
          size='md'
        />
      </div>
      <div className='flex flex-col gap-y-1'>
        <div className='flex flex-col gap-y-1 pb-3 pt-1'>
          <div className='system-md-semibold text-text-secondary'>
            <span className='relative'>
              {t('datasetPipeline.onlineDrive.notConnected', { name: nodeData.title })}
              <Icon3Dots className='absolute -right-2.5 -top-1.5 size-4 text-text-secondary' />
            </span>
          </div>
          <div className='system-sm-regular text-text-tertiary'>
            {t('datasetPipeline.onlineDrive.notConnectedTip', { name: nodeData.title })}
          </div>
        </div>
        <Button className='w-fit' variant='primary' onClick={onSetting}>
          {t('datasetCreation.stepOne.connect')}
        </Button>
      </div>
    </div>
  )
}

export default Connect
