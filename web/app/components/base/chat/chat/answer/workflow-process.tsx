import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkflowProcess } from '../../types'
import { CheckCircle } from '@/app/components/base/icons/src/vender/solid/general'
import { AlertCircle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import NodePanel from '@/app/components/workflow/run/node'

type WorkflowProcessProps = {
  data: WorkflowProcess
  grayBg?: boolean
  expand?: boolean
  hideInfo?: boolean
}
const WorkflowProcessItem = ({
  data,
  grayBg,
  expand = false,
  hideInfo = false,
}: WorkflowProcessProps) => {
  const { t } = useTranslation()
  const [collapse, setCollapse] = useState(!expand)
  const running = data.status === WorkflowRunningStatus.Running
  const succeeded = data.status === WorkflowRunningStatus.Succeeded
  const failed = data.status === WorkflowRunningStatus.Failed || data.status === WorkflowRunningStatus.Stopped

  const background = useMemo(() => {
    if (running && !collapse)
      return 'linear-gradient(180deg, #E1E4EA 0%, #EAECF0 100%)'

    if (succeeded && !collapse)
      return 'linear-gradient(180deg, #ECFDF3 0%, #F6FEF9 100%)'

    if (failed && !collapse)
      return 'linear-gradient(180deg, #FEE4E2 0%, #FEF3F2 100%)'
  }, [running, succeeded, failed, collapse])

  useEffect(() => {
    setCollapse(!expand)
  }, [expand])

  return (
    <div
      className={`
        mb-2 px-3 w-full rounded-xl border-[0.5px] border-black/[0.08]
        ${collapse ? 'py-[7px]' : 'py-2'}
        ${collapse && (!grayBg ? 'bg-white' : 'bg-gray-50')}
      `}
      style={{
        background,
      }}
    >
      <div
        className='flex items-center h-[18px] cursor-pointer'
        onClick={() => setCollapse(!collapse)}
      >
        {
          running && (
            <Loading02 className='shrink-0 mr-1 w-3 h-3 text-[#667085] animate-spin' />
          )
        }
        {
          succeeded && (
            <CheckCircle className='shrink-0 mr-1 w-3 h-3 text-[#12B76A]' />
          )
        }
        {
          failed && (
            <AlertCircle className='shrink-0 mr-1 w-3 h-3 text-[#F04438]' />
          )
        }
        <div className='grow text-xs font-medium text-gray-700'>
          {t('workflow.common.workflowProcess')}
        </div>
        <ChevronRight className={`'ml-1 w-3 h-3 text-gray-500' ${collapse ? '' : 'rotate-90'}`} />
      </div>
      {
        !collapse && (
          <div className='mt-1.5'>
            {
              data.tracing.map(node => (
                <div key={node.id} className='mb-1 last-of-type:mb-0'>
                  <NodePanel
                    className='!p-0'
                    nodeInfo={node}
                    hideInfo={hideInfo}
                  />
                </div>
              ))
            }
          </div>
        )
      }
    </div>
  )
}

export default WorkflowProcessItem
