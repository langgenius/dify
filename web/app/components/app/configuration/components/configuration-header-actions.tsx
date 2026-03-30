import type { ComponentProps } from 'react'
import { CodeBracketIcon } from '@heroicons/react/20/solid'
import { useTranslation } from 'react-i18next'
import AppPublisher from '@/app/components/app/app-publisher/features-wrapper'
import AgentSettingButton from '@/app/components/app/configuration/config/agent-setting-button'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'

type HeaderActionsProps = {
  isAgent: boolean
  isFunctionCall: boolean
  isMobile: boolean
  showModelParameterModal: boolean
  onShowDebugPanel: () => void
  agentSettingButtonProps: ComponentProps<typeof AgentSettingButton>
  modelParameterModalProps: ComponentProps<typeof ModelParameterModal>
  publisherProps: ComponentProps<typeof AppPublisher>
}

const ConfigurationHeaderActions = ({
  isAgent,
  isFunctionCall,
  isMobile,
  showModelParameterModal,
  onShowDebugPanel,
  agentSettingButtonProps,
  modelParameterModalProps,
  publisherProps,
}: HeaderActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center">
      {isAgent && (
        <AgentSettingButton
          {...agentSettingButtonProps}
          isFunctionCall={isFunctionCall}
        />
      )}

      {showModelParameterModal && (
        <>
          <ModelParameterModal {...modelParameterModalProps} />
          <Divider type="vertical" className="mx-2 h-[14px]" />
        </>
      )}

      {isMobile && (
        <Button className="mr-2 !h-8 !text-[13px] font-medium" onClick={onShowDebugPanel}>
          <span className="mr-1">{t('operation.debugConfig', { ns: 'appDebug' })}</span>
          <CodeBracketIcon className="h-4 w-4 text-text-tertiary" />
        </Button>
      )}

      <AppPublisher {...publisherProps} />
    </div>
  )
}

export default ConfigurationHeaderActions
