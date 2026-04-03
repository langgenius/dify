import type { CSSProperties, ReactNode } from 'react'
import type { TFunction } from 'i18next'
import type { ModelAndParameter } from '../configuration/debug/types'
import type { AppPublisherProps } from './index'
import type { PublishWorkflowParams } from '@/types/workflow'
import { useTranslation } from 'react-i18next'
import { CodeBrowser } from '@/app/components/base/icons/src/vender/line/development'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import Tooltip from '@/app/components/base/tooltip'
import Button from '@/app/components/base/button'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import WorkflowToolConfigureButton from '@/app/components/tools/workflow-tool/configure-button'
import { appDefaultIconBackground } from '@/config'
import { AppModeEnum } from '@/types/app'
import ShortcutsName from '../../workflow/shortcuts-name'
import SuggestedAction from './suggested-action'
import PublishWithMultipleModel from './publish-with-multiple-model'
import { ACCESS_MODE_MAP } from './utils'

type SummarySectionProps = Pick<AppPublisherProps,
  | 'debugWithMultipleModel'
  | 'draftUpdatedAt'
  | 'multipleModelConfigs'
  | 'publishDisabled'
  | 'publishedAt'
  | 'startNodeLimitExceeded'
> & {
  formatTimeFromNow: (value: number) => string
  handlePublish: (params?: ModelAndParameter | PublishWorkflowParams) => Promise<void>
  handleRestore: () => Promise<void>
  isChatApp: boolean
  published: boolean
  publishShortcut: string[]
  upgradeHighlightStyle: CSSProperties
}

type AccessSectionProps = {
  enabled: boolean
  isAppAccessSet: boolean
  isLoading: boolean
  accessMode?: keyof typeof ACCESS_MODE_MAP
  onClick: () => void
}

type ActionsSectionProps = Pick<AppPublisherProps,
  | 'hasHumanInputNode'
  | 'hasTriggerNode'
  | 'inputs'
  | 'missingStartNode'
  | 'onRefreshData'
  | 'toolPublished'
  | 'outputs'
  | 'publishedAt'
  | 'workflowToolAvailable'
> & {
  appDetail: {
    id?: string
    icon?: string
    icon_type?: string | null
    icon_background?: string | null
    description?: string
    mode?: AppModeEnum
    name?: string
  } | null | undefined
  appURL: string
  disabledFunctionButton: boolean
  disabledFunctionTooltip?: string
  handleEmbed: () => void
  handleOpenInExplore: () => void
  handlePublish: (params?: ModelAndParameter | PublishWorkflowParams) => Promise<void>
  published: boolean
  workflowToolMessage?: string
}

export const AccessModeDisplay = ({ mode }: { mode?: keyof typeof ACCESS_MODE_MAP }) => {
  const { t } = useTranslation()

  if (!mode || !ACCESS_MODE_MAP[mode])
    return null

  const { icon, label } = ACCESS_MODE_MAP[mode]

  return (
    <>
      <span className={`${icon} h-4 w-4 shrink-0 text-text-secondary`} />
      <div className="grow truncate">
        <span className="text-text-secondary system-sm-medium">{t(`accessControlDialog.accessItems.${label}`, { ns: 'app' })}</span>
      </div>
    </>
  )
}

export const PublisherSummarySection = ({
  debugWithMultipleModel = false,
  draftUpdatedAt,
  formatTimeFromNow,
  handlePublish,
  handleRestore,
  isChatApp,
  multipleModelConfigs = [],
  publishDisabled = false,
  published,
  publishedAt,
  publishShortcut,
  startNodeLimitExceeded = false,
  upgradeHighlightStyle,
}: SummarySectionProps) => {
  const { t } = useTranslation()

  return (
    <div className="p-4 pt-3">
      <div className="flex h-6 items-center text-text-tertiary system-xs-medium-uppercase">
        {publishedAt ? t('common.latestPublished', { ns: 'workflow' }) : t('common.currentDraftUnpublished', { ns: 'workflow' })}
      </div>
      {publishedAt
        ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center text-text-secondary system-sm-medium">
                {t('common.publishedAt', { ns: 'workflow' })}
                {' '}
                {formatTimeFromNow(publishedAt)}
              </div>
              {isChatApp && (
                <Button
                  variant="secondary-accent"
                  size="small"
                  onClick={handleRestore}
                  disabled={published}
                >
                  {t('common.restore', { ns: 'workflow' })}
                </Button>
              )}
            </div>
          )
        : (
            <div className="flex items-center text-text-secondary system-sm-medium">
              {t('common.autoSaved', { ns: 'workflow' })}
              {' '}
              ·
              {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
            </div>
          )}
      {debugWithMultipleModel
        ? (
            <PublishWithMultipleModel
              multipleModelConfigs={multipleModelConfigs}
              onSelect={item => handlePublish(item)}
            />
          )
        : (
            <>
              <Button
                variant="primary"
                className="mt-3 w-full"
                onClick={() => handlePublish()}
                disabled={publishDisabled || published}
              >
                {published
                  ? t('common.published', { ns: 'workflow' })
                  : (
                      <div className="flex gap-1">
                        <span>{t('common.publishUpdate', { ns: 'workflow' })}</span>
                        <ShortcutsName keys={publishShortcut} bgColor="white" />
                      </div>
                    )}
              </Button>
              {startNodeLimitExceeded && (
                <div className="mt-3 flex flex-col items-stretch">
                  <p
                    className="text-sm font-semibold leading-5 text-transparent"
                    style={upgradeHighlightStyle}
                  >
                    <span className="block">{t('publishLimit.startNodeTitlePrefix', { ns: 'workflow' })}</span>
                    <span className="block">{t('publishLimit.startNodeTitleSuffix', { ns: 'workflow' })}</span>
                  </p>
                  <p className="mt-1 text-xs leading-4 text-text-secondary">
                    {t('publishLimit.startNodeDesc', { ns: 'workflow' })}
                  </p>
                  <UpgradeBtn
                    isShort
                    className="mb-[12px] mt-[9px] h-[32px] w-[93px] self-start"
                  />
                </div>
              )}
            </>
          )}
    </div>
  )
}

export const PublisherAccessSection = ({
  enabled,
  isAppAccessSet,
  isLoading,
  accessMode,
  onClick,
}: AccessSectionProps) => {
  const { t } = useTranslation()

  if (isLoading)
    return <div className="py-2"><Loading /></div>

  return (
    <>
      <Divider className="my-0" />
      {enabled && (
        <div className="p-4 pt-3">
          <div className="flex h-6 items-center">
            <p className="text-text-tertiary system-xs-medium">{t('publishApp.title', { ns: 'app' })}</p>
          </div>
          <div
            className="flex h-8 cursor-pointer items-center gap-x-0.5 rounded-lg bg-components-input-bg-normal py-1 pl-2.5 pr-2 hover:bg-primary-50 hover:text-text-accent"
            onClick={onClick}
          >
            <div className="flex grow items-center gap-x-1.5 overflow-hidden pr-1">
              <AccessModeDisplay mode={accessMode} />
            </div>
            {!isAppAccessSet && <p className="shrink-0 text-text-tertiary system-xs-regular">{t('publishApp.notSet', { ns: 'app' })}</p>}
            <div className="flex h-4 w-4 shrink-0 items-center justify-center">
              <span className="i-ri-arrow-right-s-line h-4 w-4 text-text-quaternary" />
            </div>
          </div>
          {!isAppAccessSet && <p className="mt-1 text-text-warning system-xs-regular">{t('publishApp.notSetDesc', { ns: 'app' })}</p>}
        </div>
      )}
    </>
  )
}

const ActionTooltip = ({
  disabled,
  tooltip,
  children,
}: {
  disabled: boolean
  tooltip?: ReactNode
  children: ReactNode
}) => (
  <Tooltip triggerClassName="flex" disabled={!disabled} popupContent={tooltip} asChild={false}>
    {children}
  </Tooltip>
)

export const PublisherActionsSection = ({
  appDetail,
  appURL,
  disabledFunctionButton,
  disabledFunctionTooltip,
  handleEmbed,
  handleOpenInExplore,
  handlePublish,
  hasHumanInputNode = false,
  hasTriggerNode = false,
  inputs,
  missingStartNode = false,
  onRefreshData,
  outputs,
  published,
  publishedAt,
  toolPublished,
  workflowToolAvailable = true,
  workflowToolMessage,
}: ActionsSectionProps) => {
  const { t } = useTranslation()

  if (hasTriggerNode)
    return null

  const workflowToolDisabled = !publishedAt || !workflowToolAvailable

  return (
    <div className="flex flex-col gap-y-1 border-t-[0.5px] border-t-divider-regular p-4 pt-3">
      <ActionTooltip disabled={disabledFunctionButton} tooltip={disabledFunctionTooltip}>
        <SuggestedAction
          className="flex-1"
          disabled={disabledFunctionButton}
          link={appURL}
          icon={<span className="i-ri-play-circle-line h-4 w-4" />}
        >
          {t('common.runApp', { ns: 'workflow' })}
        </SuggestedAction>
      </ActionTooltip>
      {appDetail?.mode === AppModeEnum.WORKFLOW || appDetail?.mode === AppModeEnum.COMPLETION
        ? (
            <ActionTooltip disabled={disabledFunctionButton} tooltip={disabledFunctionTooltip}>
              <SuggestedAction
                className="flex-1"
                disabled={disabledFunctionButton}
                link={`${appURL}${appURL.includes('?') ? '&' : '?'}mode=batch`}
                icon={<span className="i-ri-play-list-2-line h-4 w-4" />}
              >
                {t('common.batchRunApp', { ns: 'workflow' })}
              </SuggestedAction>
            </ActionTooltip>
          )
        : (
            <SuggestedAction
              onClick={handleEmbed}
              disabled={!publishedAt}
              icon={<CodeBrowser className="h-4 w-4" />}
            >
              {t('common.embedIntoSite', { ns: 'workflow' })}
            </SuggestedAction>
          )}
      <ActionTooltip disabled={disabledFunctionButton} tooltip={disabledFunctionTooltip}>
        <SuggestedAction
          className="flex-1"
          onClick={() => {
            if (publishedAt)
              handleOpenInExplore()
          }}
          disabled={disabledFunctionButton}
          icon={<span className="i-ri-planet-line h-4 w-4" />}
        >
          {t('common.openInExplore', { ns: 'workflow' })}
        </SuggestedAction>
      </ActionTooltip>
      <Tooltip triggerClassName="flex" disabled={!!publishedAt && !missingStartNode} popupContent={!publishedAt ? t('notPublishedYet', { ns: 'app' }) : t('noUserInputNode', { ns: 'app' })} asChild={false}>
        <SuggestedAction
          className="flex-1"
          disabled={!publishedAt || missingStartNode}
          link="./develop"
          icon={<span className="i-ri-terminal-box-line h-4 w-4" />}
        >
          {t('common.accessAPIReference', { ns: 'workflow' })}
        </SuggestedAction>
      </Tooltip>
      {appDetail?.mode === AppModeEnum.WORKFLOW && !hasHumanInputNode && (
        <WorkflowToolConfigureButton
          disabled={workflowToolDisabled}
          published={!!toolPublished}
          detailNeedUpdate={!!toolPublished && published}
          workflowAppId={appDetail?.id ?? ''}
          icon={{
            content: (appDetail.icon_type === 'image' ? '🤖' : appDetail?.icon) || '🤖',
            background: (appDetail.icon_type === 'image' ? appDefaultIconBackground : appDetail?.icon_background) || appDefaultIconBackground,
          }}
          name={appDetail?.name ?? ''}
          description={appDetail?.description ?? ''}
          inputs={inputs}
          outputs={outputs}
          handlePublish={handlePublish}
          onRefreshData={onRefreshData}
          disabledReason={workflowToolMessage}
        />
      )}
    </div>
  )
}
