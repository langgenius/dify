import type { FC } from 'react'
import type { AppPublisherMenuContentProps } from './menu-content.types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/base/ui/toast'
import WorkflowToolConfigureButton from '@/app/components/tools/workflow-tool/configure-button'
import { appDefaultIconBackground } from '@/config'
import { AppModeEnum } from '@/types/app'
import { SuggestedActionWithTooltip } from './menu-content-shared'
import { getBatchRunLink } from './menu-content.utils'
import SuggestedAction from './suggested-action'

type MenuContentActionsSectionProps = Pick<
  AppPublisherMenuContentProps,
  | 'appDetail'
  | 'appURL'
  | 'disabledFunctionButton'
  | 'disabledFunctionTooltip'
  | 'hasHumanInputNode'
  | 'hasTriggerNode'
  | 'inputs'
  | 'missingStartNode'
  | 'onOpenEmbedding'
  | 'onOpenInExplore'
  | 'onPublish'
  | 'onRefreshData'
  | 'outputs'
  | 'published'
  | 'publishedAt'
  | 'toolPublished'
  | 'workflowToolDisabled'
  | 'workflowToolMessage'
>

const MenuContentActionsSection: FC<MenuContentActionsSectionProps> = ({
  appDetail,
  appURL,
  disabledFunctionButton,
  disabledFunctionTooltip,
  hasHumanInputNode = false,
  hasTriggerNode = false,
  inputs,
  missingStartNode = false,
  onOpenEmbedding,
  onOpenInExplore,
  onPublish,
  onRefreshData,
  outputs,
  published,
  publishedAt,
  toolPublished,
  workflowToolDisabled,
  workflowToolMessage,
}) => {
  const { t } = useTranslation()

  if (hasTriggerNode)
    return null

  const mode = appDetail?.mode
  const isBatchActionVisible = mode === AppModeEnum.WORKFLOW || mode === AppModeEnum.COMPLETION
  const apiReferenceDisabled = !publishedAt || missingStartNode
  const apiReferenceTooltip = !publishedAt
    ? t('notPublishedYet', { ns: 'app' })
    : missingStartNode
      ? t('noUserInputNode', { ns: 'app' })
      : undefined

  const handleOpenInExplore = () => {
    if (publishedAt) {
      onOpenInExplore()
      return
    }

    toast.error(t('notPublishedYet', { ns: 'app' }))
  }

  const handleWorkflowToolPublish = async (params?: PublishWorkflowParams) => {
    await onPublish(params)
  }

  return (
    <div className="flex flex-col gap-y-1 border-t-[0.5px] border-t-divider-regular p-4 pt-3">
      <SuggestedActionWithTooltip
        className="flex-1"
        disabled={disabledFunctionButton}
        icon={<span className="i-ri-play-circle-line h-4 w-4" />}
        link={appURL}
        tooltip={disabledFunctionButton ? disabledFunctionTooltip : undefined}
      >
        {t('common.runApp', { ns: 'workflow' })}
      </SuggestedActionWithTooltip>
      {isBatchActionVisible
        ? (
            <SuggestedActionWithTooltip
              className="flex-1"
              disabled={disabledFunctionButton}
              icon={<span className="i-ri-play-list-2-line h-4 w-4" />}
              link={getBatchRunLink(appURL)}
              tooltip={disabledFunctionButton ? disabledFunctionTooltip : undefined}
            >
              {t('common.batchRunApp', { ns: 'workflow' })}
            </SuggestedActionWithTooltip>
          )
        : (
            <SuggestedAction
              disabled={!publishedAt}
              icon={<span className="i-custom-vender-line-development-code-browser h-4 w-4" />}
              onClick={onOpenEmbedding}
            >
              {t('common.embedIntoSite', { ns: 'workflow' })}
            </SuggestedAction>
          )}
      <SuggestedActionWithTooltip
        className="flex-1"
        disabled={disabledFunctionButton}
        icon={<span className="i-ri-planet-line h-4 w-4" />}
        onClick={handleOpenInExplore}
        tooltip={disabledFunctionButton ? disabledFunctionTooltip : undefined}
      >
        {t('common.openInExplore', { ns: 'workflow' })}
      </SuggestedActionWithTooltip>
      <SuggestedActionWithTooltip
        className="flex-1"
        disabled={apiReferenceDisabled}
        icon={<span className="i-ri-terminal-box-line h-4 w-4" />}
        link="./develop"
        tooltip={apiReferenceTooltip}
      >
        {t('common.accessAPIReference', { ns: 'workflow' })}
      </SuggestedActionWithTooltip>
      {mode === AppModeEnum.WORKFLOW && !hasHumanInputNode && appDetail && (
        <WorkflowToolConfigureButton
          description={appDetail.description}
          detailNeedUpdate={!!toolPublished && published}
          disabled={workflowToolDisabled}
          disabledReason={workflowToolMessage}
          handlePublish={handleWorkflowToolPublish}
          icon={{
            content: (appDetail.icon_type === 'image' ? '🤖' : appDetail.icon) || '🤖',
            background: (appDetail.icon_type === 'image' ? appDefaultIconBackground : appDetail.icon_background) || appDefaultIconBackground,
          }}
          inputs={inputs}
          name={appDetail.name}
          onRefreshData={onRefreshData}
          outputs={outputs}
          published={!!toolPublished}
          workflowAppId={appDetail.id}
        />
      )}
    </div>
  )
}

export default MenuContentActionsSection
