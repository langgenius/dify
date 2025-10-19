'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { RiArrowRightUpLine, RiHammerLine } from '@remixicon/react'
import Divider from '../../base/divider'
import cn from '@/utils/classnames'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import WorkflowToolModal from '@/app/components/tools/workflow-tool'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { createWorkflowToolProvider, fetchWorkflowToolDetailByAppID, saveWorkflowToolProvider } from '@/service/tools'
import type { Emoji, WorkflowToolProviderParameter, WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '@/app/components/tools/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useAppContext } from '@/context/app-context'
import { useInvalidateAllWorkflowTools } from '@/service/use-tools'

type Props = {
  disabled: boolean
  published: boolean
  detailNeedUpdate: boolean
  workflowAppId: string
  icon: Emoji
  name: string
  description: string
  inputs?: InputVar[]
  handlePublish: (params?: PublishWorkflowParams) => Promise<void>
  onRefreshData?: () => void
}

const WorkflowToolConfigureButton = ({
  disabled,
  published,
  detailNeedUpdate,
  workflowAppId,
  icon,
  name,
  description,
  inputs,
  handlePublish,
  onRefreshData,
}: Props) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [showModal, setShowModal] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [detail, setDetail] = useState<WorkflowToolProviderResponse>()
  const { isCurrentWorkspaceManager } = useAppContext()
  const invalidateAllWorkflowTools = useInvalidateAllWorkflowTools()

  const outdated = useMemo(() => {
    if (!detail)
      return false
    if (detail.tool.parameters.length !== inputs?.length) {
      return true
    }
    else {
      for (const item of inputs || []) {
        const param = detail.tool.parameters.find(toolParam => toolParam.name === item.variable)
        if (!param) {
          return true
        }
        else if (param.required !== item.required) {
          return true
        }
        else {
          if (item.type === 'paragraph' && param.type !== 'string')
            return true
          if (item.type === 'text-input' && param.type !== 'string')
            return true
        }
      }
    }
    return false
  }, [detail, inputs])

  const payload = useMemo(() => {
    let parameters: WorkflowToolProviderParameter[] = []
    if (!published) {
      parameters = (inputs || []).map((item) => {
        return {
          name: item.variable,
          description: '',
          form: 'llm',
          required: item.required,
          type: item.type,
        }
      })
    }
    else if (detail && detail.tool) {
      parameters = (inputs || []).map((item) => {
        return {
          name: item.variable,
          required: item.required,
          type: item.type === 'paragraph' ? 'string' : item.type,
          description: detail.tool.parameters.find(param => param.name === item.variable)?.llm_description || '',
          form: detail.tool.parameters.find(param => param.name === item.variable)?.form || 'llm',
        }
      })
    }
    return {
      icon: detail?.icon || icon,
      label: detail?.label || name,
      name: detail?.name || '',
      description: detail?.description || description,
      parameters,
      labels: detail?.tool?.labels || [],
      privacy_policy: detail?.privacy_policy || '',
      ...(published
        ? {
          workflow_tool_id: detail?.workflow_tool_id,
        }
        : {
          workflow_app_id: workflowAppId,
        }),
    }
  }, [detail, published, workflowAppId, icon, name, description, inputs])

  const getDetail = useCallback(async (workflowAppId: string) => {
    setIsLoading(true)
    const res = await fetchWorkflowToolDetailByAppID(workflowAppId)
    setDetail(res)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    if (published)
      getDetail(workflowAppId)
  }, [getDetail, published, workflowAppId])

  useEffect(() => {
    if (detailNeedUpdate)
      getDetail(workflowAppId)
  }, [detailNeedUpdate, getDetail, workflowAppId])

  const createHandle = async (data: WorkflowToolProviderRequest & { workflow_app_id: string }) => {
    try {
      await createWorkflowToolProvider(data)
      invalidateAllWorkflowTools()
      onRefreshData?.()
      getDetail(workflowAppId)
      Toast.notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      setShowModal(false)
    }
    catch (e) {
      Toast.notify({ type: 'error', message: (e as Error).message })
    }
  }

  const updateWorkflowToolProvider = async (data: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => {
    try {
      await handlePublish()
      await saveWorkflowToolProvider(data)
      onRefreshData?.()
      invalidateAllWorkflowTools()
      getDetail(workflowAppId)
      Toast.notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
      setShowModal(false)
    }
    catch (e) {
      Toast.notify({ type: 'error', message: (e as Error).message })
    }
  }

  return (
    <>
      <Divider type='horizontal' className='h-px bg-divider-subtle' />
      {(!published || !isLoading) && (
        <div className={cn(
          'group rounded-lg bg-background-section-burn transition-colors',
          disabled || !isCurrentWorkspaceManager ? 'cursor-not-allowed opacity-60 shadow-xs' : 'cursor-pointer',
          !disabled && !published && isCurrentWorkspaceManager && 'hover:bg-state-accent-hover',
        )}>
          {isCurrentWorkspaceManager
            ? (
              <div
                className='flex items-center justify-start gap-2 p-2 pl-2.5'
                onClick={() => !disabled && !published && setShowModal(true)}
              >
                <RiHammerLine className={cn('relative h-4 w-4 text-text-secondary', !disabled && !published && 'group-hover:text-text-accent')} />
                <div
                  title={t('workflow.common.workflowAsTool') || ''}
                  className={cn('system-sm-medium shrink grow basis-0 truncate text-text-secondary', !disabled && !published && 'group-hover:text-text-accent')}
                >
                  {t('workflow.common.workflowAsTool')}
                </div>
                {!published && (
                  <span className='system-2xs-medium-uppercase shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 text-text-tertiary'>
                    {t('workflow.common.configureRequired')}
                  </span>
                )}
              </div>)
            : (
              <div
                className='flex items-center justify-start gap-2 p-2 pl-2.5'
              >
                <RiHammerLine className='h-4 w-4 text-text-tertiary' />
                <div
                  title={t('workflow.common.workflowAsTool') || ''}
                  className='system-sm-medium shrink grow basis-0 truncate text-text-tertiary'
                >
                  {t('workflow.common.workflowAsTool')}
                </div>
              </div>
            )}
          {published && (
            <div className='border-t-[0.5px] border-divider-regular px-2.5 py-2'>
              <div className='flex justify-between gap-x-2'>
                <Button
                  size='small'
                  className='w-[140px]'
                  onClick={() => setShowModal(true)}
                  disabled={!isCurrentWorkspaceManager}
                >
                  {t('workflow.common.configure')}
                  {outdated && <Indicator className='ml-1' color={'yellow'} />}
                </Button>
                <Button
                  size='small'
                  className='w-[140px]'
                  onClick={() => router.push('/tools?category=workflow')}
                >
                  {t('workflow.common.manageInTools')}
                  <RiArrowRightUpLine className='ml-1 h-4 w-4' />
                </Button>
              </div>
              {outdated && <div className='mt-1 text-xs leading-[18px] text-text-warning'>
                {t('workflow.common.workflowAsToolTip')}
              </div>}
            </div>
          )}
        </div>
      )}
      {published && isLoading && <div className='pt-2'><Loading type='app' /></div>}
      {showModal && (
        <WorkflowToolModal
          isAdd={!published}
          payload={payload}
          onHide={() => setShowModal(false)}
          onCreate={createHandle}
          onSave={updateWorkflowToolProvider}
        />
      )}
    </>
  )
}
export default WorkflowToolConfigureButton
