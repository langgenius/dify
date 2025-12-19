'use client'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiEditLine, RiLoopLeftLine } from '@remixicon/react'
import {
  Mcp,
} from '@/app/components/base/icons/src/vender/other'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Confirm from '@/app/components/base/confirm'
import type { AppDetailResponse } from '@/models/app'
import { useAppContext } from '@/context/app-context'
import { AppModeEnum, type AppSSO } from '@/types/app'
import Indicator from '@/app/components/header/indicator'
import MCPServerModal from '@/app/components/tools/mcp/mcp-server-modal'
import { useAppWorkflow } from '@/service/use-workflow'
import {
  useInvalidateMCPServerDetail,
  useMCPServerDetail,
  useRefreshMCPServerCode,
  useUpdateMCPServer,
} from '@/service/use-tools'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import { fetchAppDetail } from '@/service/apps'
import { useDocLink } from '@/context/i18n'

export type IAppCardProps = {
  appInfo: AppDetailResponse & Partial<AppSSO>
  triggerModeDisabled?: boolean // align with Trigger Node vs User Input exclusivity
  triggerModeMessage?: React.ReactNode // display-only message explaining the trigger restriction
}

function MCPServiceCard({
  appInfo,
  triggerModeDisabled = false,
  triggerModeMessage = '',
}: IAppCardProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const appId = appInfo.id
  const { mutateAsync: updateMCPServer } = useUpdateMCPServer()
  const { mutateAsync: refreshMCPServerCode, isPending: genLoading } = useRefreshMCPServerCode()
  const invalidateMCPServerDetail = useInvalidateMCPServerDetail()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showMCPServerModal, setShowMCPServerModal] = useState(false)

  const isAdvancedApp = appInfo?.mode === AppModeEnum.ADVANCED_CHAT || appInfo?.mode === AppModeEnum.WORKFLOW
  const isBasicApp = !isAdvancedApp
  const { data: currentWorkflow } = useAppWorkflow(isAdvancedApp ? appId : '')
  const [basicAppConfig, setBasicAppConfig] = useState<any>({})
  const basicAppInputForm = useMemo(() => {
    if(!isBasicApp || !basicAppConfig?.user_input_form)
      return []
    return basicAppConfig.user_input_form.map((item: any) => {
      const type = Object.keys(item)[0]
      return {
        ...item[type],
        type: type || 'text-input',
      }
    })
  }, [basicAppConfig.user_input_form, isBasicApp])
  useEffect(() => {
    if(isBasicApp && appId) {
      (async () => {
        const res = await fetchAppDetail({ url: '/apps', id: appId })
        setBasicAppConfig(res?.model_config || {})
      })()
    }
  }, [appId, isBasicApp])
  const { data: detail } = useMCPServerDetail(appId)
  const { id, status, server_code } = detail ?? {}

  const isWorkflowApp = appInfo.mode === AppModeEnum.WORKFLOW
  const appUnpublished = isAdvancedApp ? !currentWorkflow?.graph : !basicAppConfig.updated_at
  const serverPublished = !!id
  const serverActivated = status === 'active'
  const serverURL = serverPublished ? `${appInfo.api_base_url.replace('/v1', '')}/mcp/server/${server_code}/mcp` : '***********'
  const hasStartNode = currentWorkflow?.graph?.nodes?.some(node => node.data.type === BlockEnum.Start)
  const missingStartNode = isWorkflowApp && !hasStartNode
  const hasInsufficientPermissions = !isCurrentWorkspaceEditor
  const toggleDisabled = hasInsufficientPermissions || appUnpublished || missingStartNode || triggerModeDisabled
  const isMinimalState = appUnpublished || missingStartNode

  const [activated, setActivated] = useState(serverActivated)

  const latestParams = useMemo(() => {
    if(isAdvancedApp) {
      if (!currentWorkflow?.graph)
        return []
      const startNode = currentWorkflow?.graph.nodes.find(node => node.data.type === BlockEnum.Start) as any
      return startNode?.data.variables as any[] || []
    }
    return basicAppInputForm
  }, [currentWorkflow, basicAppInputForm, isAdvancedApp])

  const onGenCode = async () => {
    await refreshMCPServerCode(detail?.id || '')
    invalidateMCPServerDetail(appId)
  }

  const onChangeStatus = async (state: boolean) => {
    setActivated(state)
    if (state) {
      if (!serverPublished) {
        setShowMCPServerModal(true)
        return
      }

      await updateMCPServer({
        appID: appId,
        id: id || '',
        description: detail?.description || '',
        parameters: detail?.parameters || {},
        status: 'active',
      })
      invalidateMCPServerDetail(appId)
    }
    else {
      await updateMCPServer({
        appID: appId,
        id: id || '',
        description: detail?.description || '',
        parameters: detail?.parameters || {},
        status: 'inactive',
      })
      invalidateMCPServerDetail(appId)
    }
  }

  const handleServerModalHide = () => {
    setShowMCPServerModal(false)
    if (!serverActivated)
      setActivated(false)
  }

  useEffect(() => {
    setActivated(serverActivated)
  }, [serverActivated])

  if (!currentWorkflow && isAdvancedApp)
    return null

  return (
    <>
      <div className={cn('w-full max-w-full rounded-xl border-l-[0.5px] border-t border-effects-highlight', isMinimalState && 'h-12')}>
        <div className={cn('relative rounded-xl bg-background-default', triggerModeDisabled && 'opacity-60')}>
          {triggerModeDisabled && (
            triggerModeMessage ? (
              <Tooltip
                popupContent={triggerModeMessage}
                popupClassName="max-w-64 rounded-xl bg-components-panel-bg px-3 py-2 text-xs text-text-secondary shadow-lg"
                position="right"
              >
                <div className='absolute inset-0 z-10 cursor-not-allowed rounded-xl' aria-hidden="true"></div>
              </Tooltip>
            ) : <div className='absolute inset-0 z-10 cursor-not-allowed rounded-xl' aria-hidden="true"></div>
          )}
          <div className={cn('flex w-full flex-col items-start justify-center gap-3 self-stretch p-3', isMinimalState ? 'border-0' : 'border-b-[0.5px] border-divider-subtle')}>
            <div className='flex w-full items-center gap-3 self-stretch'>
              <div className='flex grow items-center'>
                <div className='mr-2 shrink-0 rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 p-1 shadow-md'>
                  <Mcp className='h-4 w-4 text-text-primary-on-surface' />
                </div>
                <div className="group w-full">
                  <div className="system-md-semibold min-w-0 overflow-hidden text-ellipsis break-normal text-text-secondary group-hover:text-text-primary">
                    {t('tools.mcp.server.title')}
                  </div>
                </div>
              </div>
              <div className='flex items-center gap-1'>
                <Indicator color={serverActivated ? 'green' : 'yellow'} />
                <div className={`${serverActivated ? 'text-text-success' : 'text-text-warning'} system-xs-semibold-uppercase`}>
                  {serverActivated
                    ? t('appOverview.overview.status.running')
                    : t('appOverview.overview.status.disable')}
                </div>
              </div>
              <Tooltip
                popupContent={
                  toggleDisabled ? (
                    appUnpublished ? (
                      t('tools.mcp.server.publishTip')
                    ) : missingStartNode ? (
                      <>
                        <div className="mb-1 text-xs font-normal text-text-secondary">
                          {t('appOverview.overview.appInfo.enableTooltip.description')}
                        </div>
                        <div
                          className="cursor-pointer text-xs font-normal text-text-accent hover:underline"
                          onClick={() => window.open(docLink('/guides/workflow/node/user-input'), '_blank')}
                        >
                          {t('appOverview.overview.appInfo.enableTooltip.learnMore')}
                        </div>
                      </>
                    ) : triggerModeMessage || ''
                  ) : ''
                }
                position="right"
                popupClassName="w-58 max-w-60 rounded-xl bg-components-panel-bg px-3.5 py-3 shadow-lg"
                offset={24}
              >
                <div>
                  <Switch defaultValue={activated} onChange={onChangeStatus} disabled={toggleDisabled} />
                </div>
              </Tooltip>
            </div>
            {!isMinimalState && (
              <div className='flex flex-col items-start justify-center self-stretch'>
                <div className="system-xs-medium pb-1 text-text-tertiary">
                  {t('tools.mcp.server.url')}
                </div>
                <div className="inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
                  <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
                    <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-text-secondary">
                      {serverURL}
                    </div>
                  </div>
                  {serverPublished && (
                    <>
                      <CopyFeedback
                        content={serverURL}
                        className={'!size-6'}
                      />
                      <Divider type="vertical" className="!mx-0.5 !h-3.5 shrink-0" />
                      {isCurrentWorkspaceManager && (
                        <Tooltip
                          popupContent={t('appOverview.overview.appInfo.regenerate') || ''}
                        >
                          <div
                            className="cursor-pointer rounded-md p-1 hover:bg-state-base-hover"
                            onClick={() => setShowConfirmDelete(true)}
                          >
                            <RiLoopLeftLine className={cn('h-4 w-4 text-text-tertiary hover:text-text-secondary', genLoading && 'animate-spin')}/>
                          </div>
                        </Tooltip>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          {!isMinimalState && (
            <div className='flex items-center gap-1 self-stretch p-3'>
              <Button
                disabled={toggleDisabled}
                size='small'
                variant='ghost'
                onClick={() => setShowMCPServerModal(true)}
              >

                <div className="flex items-center justify-center gap-[1px]">
                  <RiEditLine className="h-3.5 w-3.5" />
                  <div className="system-xs-medium px-[3px] text-text-tertiary">{serverPublished ? t('tools.mcp.server.edit') : t('tools.mcp.server.addDescription')}</div>
                </div>
              </Button>
            </div>
          )}
        </div>
      </div>
      {showMCPServerModal && (
        <MCPServerModal
          show={showMCPServerModal}
          appID={appId}
          data={serverPublished ? detail : undefined}
          latestParams={latestParams}
          onHide={handleServerModalHide}
          appInfo={appInfo}
        />
      )}
      {/* button copy link/ button regenerate */}
      {showConfirmDelete && (
        <Confirm
          type='warning'
          title={t('appOverview.overview.appInfo.regenerate')}
          content={t('tools.mcp.server.reGen')}
          isShow={showConfirmDelete}
          onConfirm={() => {
            onGenCode()
            setShowConfirmDelete(false)
          }}
          onCancel={() => setShowConfirmDelete(false)}
        />
      )}
    </>
  )
}

export default MCPServiceCard
