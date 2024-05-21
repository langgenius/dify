'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import Button from '@/app/components/base/button'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { Tools } from '@/app/components/base/icons/src/vender/line/others'
import Indicator from '@/app/components/header/indicator'
import WorkflowToolModal from '@/app/components/tools/workflow-tool'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { fetchWorkflowToolDetail, saveWorkflowToolProvider } from '@/service/tools'
import type { Emoji, WorkflowToolProvider, WorkflowToolProviderParameter } from '@/app/components/tools/types'
import type { InputVar } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'

type Props = {
  disabled: boolean
  published: boolean
  workflowAppId: string
  icon: Emoji
  name: string
  description: string
  inputs?: InputVar[]
  onRefreshData?: () => void
}

const WorkflowToolConfigureButton = ({
  disabled,
  published,
  workflowAppId,
  icon,
  name,
  description,
  inputs,
  onRefreshData,
}: Props) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [detail, setDetail] = useState<WorkflowToolProvider>()
  const [outdated, setOutdated] = useState(false)

  const getParameterType = (type: string) => {
    if (type === InputVarType.number)
      return 'Number'
    else if (type === InputVarType.files)
      return 'Files'
    else
      return 'String'
  }

  const payload = useMemo(() => {
    let parameters: WorkflowToolProviderParameter[] = []
    if (inputs) {
      parameters = (inputs || []).map((item) => {
        return {
          name: item.variable,
          description: '',
          form: 'llm',
          required: item.required,
          type: getParameterType(item.type),
        }
      })
    }
    return {
      workflow_app_id: workflowAppId,
      name,
      description,
      icon,
      parameters,
      labels: detail?.labels || [],
      privacy_policy: detail?.privacy_policy || '',
    }
  }, [detail, workflowAppId, icon, name, description, inputs])

  const getDetail = useCallback(async (workflowAppId: string) => {
    setIsLoading(true)
    const res = await fetchWorkflowToolDetail(workflowAppId)
    setDetail(res)
    setOutdated(!res?.synced)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    if (published)
      getDetail(workflowAppId)
  }, [getDetail, published, workflowAppId])

  const updateWorkflowToolProvider = async (data: WorkflowToolProvider) => {
    await saveWorkflowToolProvider(data)
    onRefreshData?.()
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setShowModal(false)
  }

  return (
    <>
      <div className='mt-2 pt-2 border-t-[0.5px] border-t-black/5'>
        {(!published || !isLoading) && (
          <div className={cn(
            'group bg-gray-100 rounded-lg transition-colors',
            disabled ? 'shadow-xs opacity-30 cursor-not-allowed' : 'cursor-pointer',
            !published && 'hover:bg-primary-50',
          )}>
            <div
              className='flex justify-start items-center gap-2 px-2.5 py-2'
              onClick={() => !published && setShowModal(true)}
            >
              <Tools className={cn('relative w-4 h-4', !published && 'group-hover:text-primary-600')}/>
              <div title={t('workflow.common.workflowAsTool') || ''} className={cn('grow shrink basis-0 text-[13px] font-medium leading-[18px] truncate', !published && 'group-hover:text-primary-600')}>{t('workflow.common.workflowAsTool')}</div>
              {!published && (
                <span className='shrink-0 px-1 border border-black/8 rounded-[5px] bg-white text-[10px] font-medium leading-[18px] text-gray-500'>{t('workflow.common.configureRequired').toLocaleUpperCase()}</span>
              )}
            </div>
            {published && (
              <div className='px-2.5 py-2 border-t-[0.5px] border-black/5'>
                <div className='flex justify-between'>
                  <Button
                    className='px-2 w-[140px] py-0 h-6 shadow-xs rounded-md text-xs font-medium text-gray-700 border-[0.5px] bg-white border-gray-200'
                    onClick={() => setShowModal(true)}
                  >
                    {t('workflow.common.configure')}
                    {outdated && <Indicator className='ml-1' color={'yellow'} />}
                  </Button>
                  <Button
                    className='px-2 w-[140px] py-0 h-6 shadow-xs rounded-md text-xs font-medium text-gray-700 border-[0.5px] bg-white border-gray-200'
                    onClick={() => router.push('/tools?category=workflow')}
                  >
                    {t('workflow.common.manageInTools')}
                    <ArrowUpRight className='ml-1' />
                  </Button>
                </div>
                {outdated && <div className='mt-1 text-xs leading-[18px] text-[#dc6803]'>{t('workflow.common.workflowAsToolTip')}</div>}
              </div>
            )}
          </div>
        )}
        {published && isLoading && <div className='pt-2'><Loading type='app'/></div>}
      </div>
      {showModal && (
        <WorkflowToolModal
          isAdd={!published}
          payload={payload}
          onHide={() => setShowModal(false)}
          onSave={updateWorkflowToolProvider}
        />
      )}
    </>
  )
}
export default WorkflowToolConfigureButton
