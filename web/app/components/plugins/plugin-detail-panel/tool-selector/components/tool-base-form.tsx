'use client'
import type { OffsetOptions } from '@floating-ui/react'
import type { FC } from 'react'
import type { PluginDetail } from '@/app/components/plugins/types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import { ReadmeEntrance } from '../../../readme-panel/entrance'
import ToolTrigger from './tool-trigger'

type ToolBaseFormProps = {
  value?: ToolValue
  currentProvider?: ToolWithProvider
  offset?: OffsetOptions
  scope?: string
  selectedTools?: ToolValue[]
  isShowChooseTool: boolean
  panelShowState?: boolean
  hasTrigger: boolean
  onShowChange: (show: boolean) => void
  onPanelShowStateChange?: (state: boolean) => void
  onSelectTool: (tool: ToolDefaultValue) => void
  onSelectMultipleTool: (tools: ToolDefaultValue[]) => void
  onDescriptionChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
}

const ToolBaseForm: FC<ToolBaseFormProps> = ({
  value,
  currentProvider,
  offset = 4,
  scope,
  selectedTools,
  isShowChooseTool,
  panelShowState,
  hasTrigger,
  onShowChange,
  onPanelShowStateChange,
  onSelectTool,
  onSelectMultipleTool,
  onDescriptionChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 px-4 py-2">
      {/* Tool picker */}
      <div className="flex flex-col gap-1">
        <div className="system-sm-semibold flex h-6 items-center justify-between text-text-secondary">
          {t('detailPanel.toolSelector.toolLabel', { ns: 'plugin' })}
          {currentProvider?.plugin_unique_identifier && (
            <ReadmeEntrance
              pluginDetail={currentProvider as unknown as PluginDetail}
              showShortTip
              className="pb-0"
            />
          )}
        </div>
        <ToolPicker
          placement="bottom"
          offset={offset}
          trigger={(
            <ToolTrigger
              open={panelShowState || isShowChooseTool}
              value={value}
              provider={currentProvider}
            />
          )}
          isShow={panelShowState || isShowChooseTool}
          onShowChange={hasTrigger ? (onPanelShowStateChange || (() => {})) : onShowChange}
          disabled={false}
          supportAddCustomTool
          onSelect={onSelectTool}
          onSelectMultiple={onSelectMultipleTool}
          scope={scope}
          selectedTools={selectedTools}
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1">
        <div className="system-sm-semibold flex h-6 items-center text-text-secondary">
          {t('detailPanel.toolSelector.descriptionLabel', { ns: 'plugin' })}
        </div>
        <Textarea
          className="resize-none"
          placeholder={t('detailPanel.toolSelector.descriptionPlaceholder', { ns: 'plugin' })}
          value={value?.extra?.description || ''}
          onChange={onDescriptionChange}
          disabled={!value?.provider_name}
        />
      </div>
    </div>
  )
}

export default ToolBaseForm
