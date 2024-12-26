'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ToolTrigger from '@/app/components/plugins/plugin-detail-panel/tool-selector/tool-trigger'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import ToolCredentialForm from '@/app/components/plugins/plugin-detail-panel/tool-selector/tool-credentials-form'
import Toast from '@/app/components/base/toast'
import Textarea from '@/app/components/base/textarea'

import { useAppContext } from '@/context/app-context'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllWorkflowTools,
  useInvalidateAllBuiltInTools,
  useUpdateProviderCredentials,
} from '@/service/use-tools'
import { CollectionType } from '@/app/components/tools/types'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type {
  OffsetOptions,
  Placement,
} from '@floating-ui/react'
import cn from '@/utils/classnames'

type Props = {
  value?: {
    provider: string
    tool_name: string
    description?: string
    parameters?: Record<string, any>
  }
  disabled?: boolean
  placement?: Placement
  offset?: OffsetOptions
  onSelect: (tool: {
    provider: string
    tool_name: string
    description?: string
    parameters?: Record<string, any>
  }) => void
  supportAddCustomTool?: boolean
  scope?: string
}
const ToolSelector: FC<Props> = ({
  value,
  disabled,
  placement = 'left',
  offset = 4,
  onSelect,
  scope,
}) => {
  const { t } = useTranslation()
  const [isShow, onShowChange] = useState(false)
  const handleTriggerClick = () => {
    if (disabled) return
    onShowChange(true)
  }

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const invalidateAllBuiltinTools = useInvalidateAllBuiltInTools()
  const currentProvider = useMemo(() => {
    const mergedTools = [...(buildInTools || []), ...(customTools || []), ...(workflowTools || [])]
    return mergedTools.find((toolWithProvider) => {
      return toolWithProvider.id === value?.provider && toolWithProvider.tools.some(tool => tool.name === value?.tool_name)
    })
  }, [value, buildInTools, customTools, workflowTools])
  const [isShowChooseTool, setIsShowChooseTool] = useState(false)
  const handleSelectTool = (tool: ToolDefaultValue) => {
    const toolValue = {
      provider: tool.provider_id,
      tool_name: tool.tool_name,
      description: '',
      parameters: {},
    }
    onSelect(toolValue)
    setIsShowChooseTool(false)
    // if (tool.provider_type === CollectionType.builtIn && tool.is_team_authorization)
    //   onShowChange(false)
  }

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onSelect({
      ...value,
      description: e.target.value || '',
    } as any)
  }

  // authorization
  const { isCurrentWorkspaceManager } = useAppContext()
  const [isShowSettingAuth, setShowSettingAuth] = useState(false)
  const handleCredentialSettingUpdate = () => {
    invalidateAllBuiltinTools()
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setShowSettingAuth(false)
    onShowChange(false)
  }

  const { mutate: updatePermission } = useUpdateProviderCredentials({
    onSuccess: handleCredentialSettingUpdate,
  })

  return (
    <>
      <PortalToFollowElem
        placement={placement}
        offset={offset}
        open={isShow}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          className='w-full'
          onClick={handleTriggerClick}
        >
          <ToolTrigger
            isConfigure
            open={isShow}
            value={value}
            provider={currentProvider}
          />
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div className="relative w-[361px] min-h-20 pb-2 rounded-xl backdrop-blur-sm bg-components-panel-bg-blur border-[0.5px] border-components-panel-border shadow-lg">
            <div className='px-4 pt-3.5 pb-1 text-text-primary system-xl-semibold'>{t('plugin.detailPanel.toolSelector.title')}</div>
            <div className='px-4 py-2 flex flex-col gap-3'>
              <div className='flex flex-col gap-1'>
                <div className='h-6 flex items-center system-sm-semibold text-text-secondary'>{t('plugin.detailPanel.toolSelector.toolLabel')}</div>
                <ToolPicker
                  placement='bottom'
                  offset={offset}
                  trigger={
                    <ToolTrigger
                      open={isShowChooseTool}
                      value={value}
                      provider={currentProvider}
                    />
                  }
                  isShow={isShowChooseTool}
                  onShowChange={setIsShowChooseTool}
                  disabled={false}
                  supportAddCustomTool
                  onSelect={handleSelectTool}
                  scope={scope}
                />
              </div>
              <div className='flex flex-col gap-1'>
                <div className='h-6 flex items-center system-sm-semibold text-text-secondary'>{t('plugin.detailPanel.toolSelector.descriptionLabel')}</div>
                <Textarea
                  className='resize-none'
                  placeholder={t('plugin.detailPanel.toolSelector.descriptionPlaceholder')}
                  value={value?.description || ''}
                  onChange={handleDescriptionChange}
                />
              </div>
            </div>
            {/* authorization panel */}
            {isShowSettingAuth && currentProvider && (
              <div className='px-4 pb-4 border-t border-divider-subtle'>
                <ToolCredentialForm
                  collection={currentProvider}
                  onCancel={() => setShowSettingAuth(false)}
                  onSaved={async value => updatePermission({
                    providerName: currentProvider.name,
                    credentials: value,
                  })}
                />
              </div>
            )}
            {!isShowSettingAuth && currentProvider && currentProvider.type === CollectionType.builtIn && currentProvider.is_team_authorization && currentProvider.allow_delete && (
              <div className='px-4 py-3 flex items-center border-t border-divider-subtle'>
                <div className='grow mr-3 h-6 flex items-center system-sm-semibold text-text-secondary'>{t('plugin.detailPanel.toolSelector.auth')}</div>
                {isCurrentWorkspaceManager && (
                  <Button
                    variant='secondary'
                    size='small'
                    onClick={() => {}}
                  >
                    <Indicator className='mr-2' color={'green'} />
                    {t('tools.auth.authorized')}
                  </Button>
                )}
              </div>
            )}
            {!isShowSettingAuth && currentProvider && currentProvider.type === CollectionType.builtIn && !currentProvider.is_team_authorization && currentProvider.allow_delete && (
              <div className='px-4 py-3 flex items-center border-t border-divider-subtle'>
                <Button
                  variant='primary'
                  className={cn('shrink-0 w-full')}
                  onClick={() => setShowSettingAuth(true)}
                  disabled={!isCurrentWorkspaceManager}
                >
                  {t('tools.auth.unauthorized')}
                </Button>
              </div>
            )}
          </div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </>
  )
}
export default React.memo(ToolSelector)
