import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { FC, RefObject } from 'react'
import type { InputValueTypes, TextGenerationCustomConfig, TextGenerationRunControl } from './types'
import type { PromptConfig, SavedMessage, TextToSpeechConfig } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import type { VisionFile, VisionSettings } from '@/types/app'
import { cn } from '@langgenius/dify-ui/cn'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { RiArrowDownSLine, RiArrowUpSLine } from '@remixicon/react'
import { useCallback, useState } from 'react'
import { useTranslation } from '#i18n'
import SavedItems from '@/app/components/app/text-generate/saved-items'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import DifyLogo from '@/app/components/base/logo/dify-logo'
import { appDefaultIconBackground } from '@/config'
import { AccessMode } from '@/models/access-control'
import MenuDropdown from './menu-dropdown'
import RunBatch from './run-batch'
import RunOnce from './run-once'

type TextGenerationSidebarProps = {
  accessMode: AccessMode
  allTasksRun: boolean
  currentTab: string
  customConfig: TextGenerationCustomConfig | null
  inputs: Record<string, InputValueTypes>
  inputsRef: RefObject<Record<string, InputValueTypes>>
  isInstalledApp: boolean
  isPC: boolean
  isWorkflow: boolean
  onBatchSend: (data: string[][]) => void
  onInputsChange: (inputs: Record<string, InputValueTypes>) => void
  onRemoveSavedMessage: (messageId: string) => Promise<void>
  onRunOnceSend: () => void
  onTabChange: (tab: string) => void
  onVisionFilesChange: (files: VisionFile[]) => void
  promptConfig: PromptConfig
  resultExisted: boolean
  runControl: TextGenerationRunControl | null
  savedMessages: SavedMessage[]
  siteInfo: SiteInfo
  systemFeatures: GetSystemFeaturesResponse
  textToSpeechConfig: TextToSpeechConfig | null
  visionConfig: VisionSettings
}

const TextGenerationSidebar: FC<TextGenerationSidebarProps> = ({
  accessMode,
  allTasksRun,
  currentTab,
  customConfig,
  inputs,
  inputsRef,
  isInstalledApp,
  isPC,
  isWorkflow,
  onBatchSend,
  onInputsChange,
  onRemoveSavedMessage,
  onRunOnceSend,
  onTabChange,
  onVisionFilesChange,
  promptConfig,
  resultExisted,
  runControl,
  savedMessages,
  siteInfo,
  systemFeatures,
  textToSpeechConfig,
  visionConfig,
}) => {
  const { t } = useTranslation()
  const [descExpanded, setDescExpanded] = useState(false)
  const [showDescToggle, setShowDescToggle] = useState(false)
  const handleDescRef = useCallback((node: HTMLDivElement | null) => {
    setShowDescToggle(!!node && node.scrollHeight > node.clientHeight)
  }, [])

  return (
    <Tabs
      value={currentTab}
      onValueChange={onTabChange}
      className={cn(
        'relative flex h-full shrink-0 flex-col',
        isPC ? 'w-[600px] max-w-[50%]' : resultExisted ? 'h-[calc(100%-64px)]' : '',
        isInstalledApp && 'rounded-l-2xl',
      )}
    >
      <div className={cn('shrink-0 space-y-4 border-b border-divider-subtle', isPC ? 'bg-components-panel-bg p-8 pb-0' : 'p-4 pb-0')}>
        <div className="flex items-center gap-3">
          <AppIcon
            size={isPC ? 'large' : 'small'}
            iconType={siteInfo.icon_type}
            icon={siteInfo.icon}
            background={siteInfo.icon_background || appDefaultIconBackground}
            imageUrl={siteInfo.icon_url}
          />
          <div className="grow truncate system-md-semibold text-text-secondary">{siteInfo.title}</div>
          <MenuDropdown hideLogout={isInstalledApp || accessMode === AccessMode.PUBLIC} data={siteInfo} />
        </div>
        {siteInfo.description && (
          <div>
            <div
              ref={handleDescRef}
              className={cn(
                'relative system-xs-regular break-words whitespace-pre-wrap text-text-tertiary',
                !descExpanded && 'line-clamp-3',
                descExpanded && 'max-h-32 overflow-y-auto',
              )}
            >
              {siteInfo.description}
              {!descExpanded && showDescToggle && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-b from-components-panel-bg-transparent to-components-panel-bg" />
              )}
            </div>
            {showDescToggle && (
              <button
                type="button"
                className="mt-0.5 flex items-center gap-0.5 system-xs-regular text-text-accent hover:opacity-80"
                onClick={() => setDescExpanded(v => !v)}
              >
                {descExpanded
                  ? (
                      <>
                        <RiArrowUpSLine className="size-3" />
                        {t('chat.collapse', { ns: 'share' })}
                      </>
                    )
                  : (
                      <>
                        <RiArrowDownSLine className="size-3" />
                        {t('chat.expand', { ns: 'share' })}
                      </>
                    )}
              </button>
            )}
          </div>
        )}
        <TabsList className="w-full">
          <TabsTab value="create">
            <span className="ml-2">{t('generation.tabs.create', { ns: 'share' })}</span>
          </TabsTab>
          <TabsTab value="batch">
            <span className="ml-2">{t('generation.tabs.batch', { ns: 'share' })}</span>
          </TabsTab>
          {!isWorkflow && (
            <TabsTab value="saved" className="ml-auto">
              <span aria-hidden className="i-ri-bookmark-3-line size-4" />
              <span className="ml-2">{t('generation.tabs.saved', { ns: 'share' })}</span>
              {savedMessages.length > 0 && (
                <Badge className="ml-1">
                  {savedMessages.length}
                </Badge>
              )}
            </TabsTab>
          )}
        </TabsList>
      </div>
      <div
        className={cn(
          'h-0 grow overflow-y-auto bg-components-panel-bg',
          isPC ? 'px-8' : 'px-4',
          !isPC && resultExisted && customConfig?.remove_webapp_brand && 'rounded-b-2xl border-b-[0.5px] border-divider-regular',
        )}
      >
        <TabsPanel value="create" keepMounted>
          <RunOnce
            siteInfo={siteInfo}
            inputs={inputs}
            inputsRef={inputsRef}
            onInputsChange={onInputsChange}
            promptConfig={promptConfig}
            onSend={onRunOnceSend}
            visionConfig={visionConfig}
            onVisionFilesChange={onVisionFilesChange}
            runControl={runControl}
          />
        </TabsPanel>
        <TabsPanel value="batch" keepMounted>
          <RunBatch
            vars={promptConfig.prompt_variables}
            onSend={onBatchSend}
            isAllFinished={allTasksRun}
          />
        </TabsPanel>
        {!isWorkflow && (
          <TabsPanel value="saved">
            <SavedItems
              className={cn(isPC ? 'mt-6' : 'mt-4')}
              isShowTextToSpeech={textToSpeechConfig?.enabled}
              list={savedMessages}
              onRemove={onRemoveSavedMessage}
              onStartCreateContent={() => onTabChange('create')}
            />
          </TabsPanel>
        )}
      </div>
      {!customConfig?.remove_webapp_brand && (
        <div
          className={cn(
            'flex shrink-0 items-center gap-1.5 bg-components-panel-bg py-3',
            isPC ? 'px-8' : 'px-4',
            !isPC && resultExisted && 'rounded-b-2xl border-b-[0.5px] border-divider-regular',
          )}
        >
          <div className="system-2xs-medium-uppercase text-text-tertiary">{t('chat.poweredBy', { ns: 'share' })}</div>
          {systemFeatures.branding.enabled && systemFeatures.branding.workspace_logo
            ? <img src={systemFeatures.branding.workspace_logo} alt="logo" className="block h-5 w-auto" />
            : customConfig?.replace_webapp_logo
              ? <img src={customConfig.replace_webapp_logo} alt="logo" className="block h-5 w-auto" />
              : <DifyLogo size="small" />}
        </div>
      )}
    </Tabs>
  )
}

export default TextGenerationSidebar
