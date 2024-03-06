import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import { Play } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { Loading02 } from '@/app/components/base/icons/src/vender/line/general'
import { Mode } from '@/app/components/workflow/types'
import { useStore as useAppStore } from '@/app/components/app/store'

const RunAndHistory: FC = () => {
  const { t } = useTranslation()
  const appDetail = useAppStore(state => state.appDetail)
  const mode = useStore(state => state.mode)
  const showRunHistory = useStore(state => state.showRunHistory)

  return (
    <div className='flex items-center px-0.5 h-8 rounded-lg border-[0.5px] border-gray-200 bg-white shadow-xs'>
      <div
        className={`
          flex items-center px-1.5 h-7 rounded-md text-[13px] font-medium text-primary-600
          hover:bg-primary-50 cursor-pointer
          ${mode === 'running' && 'bg-primary-50 !cursor-not-allowed'}
          ${mode === 'running' && appDetail?.mode !== 'workflow' && 'opacity-50'}
        `}
        onClick={() => mode !== 'running' && useStore.setState({ mode: Mode.Running })}
      >
        {
          mode === 'running'
            ? (
              <>
                {
                  appDetail?.mode === 'workflow' && (
                    <Loading02 className='mr-1 w-4 h-4 animate-spin' />
                  )
                }
                {
                  appDetail?.mode === 'workflow'
                    ? t('workflow.common.running')
                    : t('workflow.common.inPreview')
                }
              </>
            )
            : (
              <>
                <Play className='mr-1 w-4 h-4' />
                {
                  appDetail?.mode === 'workflow'
                    ? t('workflow.common.run')
                    : t('workflow.common.preview')
                }
              </>
            )
        }
      </div>
      <div className='mx-0.5 w-[0.5px] h-8 bg-gray-200'></div>
      <TooltipPlus
        popupContent={t('workflow.common.viewRunHistory')}
      >
        <div
          className={`
            flex items-center justify-center w-7 h-7 rounded-md hover:bg-black/5 cursor-pointer
            ${showRunHistory && 'bg-primary-50'}
          `}
          onClick={() => useStore.setState({ showRunHistory: true })}
        >
          <ClockPlay className={`w-4 h-4 ${showRunHistory ? 'text-primary-600' : 'text-gray-500'}`} />
        </div>
      </TooltipPlus>
    </div>
  )
}

export default memo(RunAndHistory)
