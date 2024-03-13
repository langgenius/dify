import type { FC } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../store'
import {
  useIsChatMode,
  useWorkflowRun,
} from '../hooks'
import RunAndHistory from './run-and-history'
import EditingTitle from './editing-title'
import RunningTitle from './running-title'
import Publish from './publish'
import { Grid01 } from '@/app/components/base/icons/src/vender/line/layout'
import Button from '@/app/components/base/button'
import { ArrowNarrowLeft } from '@/app/components/base/icons/src/vender/line/arrows'
import { useStore as useAppStore } from '@/app/components/app/store'

const Header: FC = () => {
  const { t } = useTranslation()
  const appDetail = useAppStore(s => s.appDetail)
  const appSidebarExpand = useAppStore(s => s.appSidebarExpand)
  const isChatMode = useIsChatMode()
  const runningStatus = useStore(s => s.runningStatus)
  const { handleRunSetting } = useWorkflowRun()

  const handleShowFeatures = useCallback(() => {
    useStore.setState({ showFeaturesPanel: true })
  }, [])

  const handleGoBackToEdit = useCallback(() => {
    handleRunSetting(true)
  }, [handleRunSetting])

  return (
    <div
      className='absolute top-0 left-0 flex items-center justify-between px-3 w-full h-14 z-10'
      style={{
        background: 'linear-gradient(180deg, #F9FAFB 0%, rgba(249, 250, 251, 0.00) 100%)',
      }}
    >
      <div>
        {
          appSidebarExpand === 'collapse' && (
            <div className='text-xs font-medium text-gray-700'>{appDetail?.name}</div>
          )
        }
        {
          !runningStatus && <EditingTitle />
        }
        {
          runningStatus && <RunningTitle />
        }
      </div>
      <div className='flex items-center'>
        {
          runningStatus && (
            <Button
              className={`
                mr-2 px-3 py-0 h-8 bg-white text-[13px] font-medium text-primary-600
                border-[0.5px] border-gray-200 shadow-xs
              `}
              onClick={handleGoBackToEdit}
            >
              <ArrowNarrowLeft className='mr-1 w-4 h-4' />
              {t('workflow.common.goBackToEdit')}
            </Button>
          )
        }
        <RunAndHistory />
        <div className='mx-2 w-[1px] h-3.5 bg-gray-200'></div>
        {
          isChatMode && (
            <Button
              className={`
                mr-2 px-3 py-0 h-8 bg-white text-[13px] font-medium text-gray-700
                border-[0.5px] border-gray-200 shadow-xs
              `}
              onClick={handleShowFeatures}
            >
              <Grid01 className='mr-1 w-4 h-4 text-gray-500' />
              {t('workflow.common.features')}
            </Button>
          )
        }
        <Publish />
      </div>
    </div>
  )
}

export default memo(Header)
