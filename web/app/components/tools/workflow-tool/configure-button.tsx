'use client'
import type { Emoji, WorkflowToolProviderOutputParameter, WorkflowToolProviderParameter, WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { RiArrowRightUpLine, RiHammerLine } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import Indicator from '@/app/components/header/indicator'
import WorkflowToolModal from '@/app/components/tools/workflow-tool'
import { useAppContext } from '@/context/app-context'
import { createWorkflowToolProvider, fetchWorkflowToolDetailByAppID, saveWorkflowToolProvider } from '@/service/tools'
import { useInvalidateAllWorkflowTools } from '@/service/use-tools'
import { cn } from '@/utils/classnames'
import Divider from '../../base/divider'

type Props = {
  disabled: boolean
  published: boolean
  detailNeedUpdate: boolean
  workflowAppId: string
  icon: Emoji
  name: string
  description: string
  inputs?: InputVar[]
  outputs?: Variable[]
  handlePublish: (params?: PublishWorkflowParams) => Promise<void>
  onRefreshData?: () => void
  disabledReason?: string
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
  outputs,
  handlePublish,
  onRefreshData,
  disabledReason,
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
    let outputParameters: WorkflowToolProviderOutputParameter[] = []

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
      outputParameters = (outputs || []).map((item) => {
        return {
          name: item.variable,
          description: '',
          type: item.value_type,
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
      outputParameters = (outputs || []).map((item) => {
        const found = detail.tool.output_schema?.properties?.[item.variable]
        return {
          name: item.variable,
          description: found ? found.description : '',
          type: item.value_type,
        }
      })
    }
    return {
      icon: detail?.icon || icon,
      label: detail?.label || name,
      name: detail?.name || '',
      description: detail?.description || description,
      parameters,
      outputParameters,
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
        message: t('api.actionSuccess', { ns: 'common' }),
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
        message: t('api.actionSuccess', { ns: 'common' }),
      })
      setShowModal(false)
    }
    catch (e) {
      Toast.notify({ type: 'error', message: (e as Error).message })
    }
  }

  return (
    <>
      <Divider type="horizontal" className="h-px bg-divider-subtle" />
      {(!published || !isLoading) && (
        <div className={cn(
          'group rounded-lg bg-background-section-burn transition-colors',
          disabled || !isCurrentWorkspaceManager ? 'cursor-not-allowed opacity-60 shadow-xs' : 'cursor-pointer',
          !disabled && !published && isCurrentWorkspaceManager && 'hover:bg-state-accent-hover',
        )}
        >
          {isCurrentWorkspaceManager
            ? (
                <div
                  className="flex items-center justify-start gap-2 p-2 pl-2.5"
                  onClick={() => !disabled && !published && setShowModal(true)}
                >
                  <RiHammerLine className={cn('relative h-4 w-4 text-text-secondary', !disabled && !published && 'group-hover:text-text-accent')} />
                  <div
                    title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
                    className={cn('system-sm-medium shrink grow basis-0 truncate text-text-secondary', !disabled && !published && 'group-hover:text-text-accent')}
                  >
                    {t('common.workflowAsTool', { ns: 'workflow' })}
                  </div>
                  {!published && (
                    <span className="system-2xs-medium-uppercase shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 text-text-tertiary">
                      {t('common.configureRequired', { ns: 'workflow' })}
                    </span>
                  )}
                </div>
              )
            : (
                <div
                  className="flex items-center justify-start gap-2 p-2 pl-2.5"
                >
                  <RiHammerLine className="h-4 w-4 text-text-tertiary" />
                  <div
                    title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
                    className="system-sm-medium shrink grow basis-0 truncate text-text-tertiary"
                  >
                    {t('common.workflowAsTool', { ns: 'workflow' })}
                  </div>
                </div>
              )}
          {disabledReason && (
            <div className="mt-1 px-2.5 pb-2 text-xs leading-[18px] text-text-tertiary">
              {disabledReason}
            </div>
          )}
          {published && (
            <div className="border-t-[0.5px] border-divider-regular px-2.5 py-2">
              <div className="flex justify-between gap-x-2">
                <Button
                  size="small"
                  className="w-[140px]"
                  onClick={() => setShowModal(true)}
                  disabled={!isCurrentWorkspaceManager || disabled}
                >
                  {t('common.configure', { ns: 'workflow' })}
                  {outdated && <Indicator className="ml-1" color="yellow" />}
                </Button>
                <Button
                  size="small"
                  className="w-[140px]"
                  onClick={() => router.push('/tools?category=workflow')}
                  disabled={disabled}
                >
                  {t('common.manageInTools', { ns: 'workflow' })}
                  <RiArrowRightUpLine className="ml-1 h-4 w-4" />
                </Button>
              </div>
              {outdated && (
                <div className="mt-1 text-xs leading-[18px] text-text-warning">
                  {t('common.workflowAsToolTip', { ns: 'workflow' })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {published && isLoading && <div className="pt-2"><Loading type="app" /></div>}
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
