'use client'
import type { PluginDetail } from '@/app/components/plugins/types'
import type { ToolPickerScope } from '@/app/components/workflow/block-selector/tool-picker'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useTranslation } from 'react-i18next'
import ToolPicker from '@/app/components/workflow/block-selector/tool-picker'
import { ReadmeEntrance } from '../../../readme-panel/entrance'
import { ToolTrigger } from './tool-trigger'

type ToolBaseFormProps = {
  value?: ToolValue
  currentProvider?: ToolWithProvider
  scope?: string
  selectedTools?: ToolValue[]
  isShowChooseTool: boolean
  panelShowState?: boolean
  hasTrigger: boolean
  onShowChange: (show: boolean) => void
  onPanelShowStateChange?: (state: boolean) => void
  onSelectTool: (tool: ToolDefaultValue) => void
  onSelectMultipleTool: (tools: ToolDefaultValue[]) => void
  onDescriptionChange: (value: string) => void
}

function resolveToolPickerScope(scope?: string): ToolPickerScope {
  if (scope === 'plugins' || scope === 'custom' || scope === 'workflow') return scope
  return 'all'
}

export function ToolBaseForm({
  value,
  currentProvider,
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
}: ToolBaseFormProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-3 px-4 py-2">
      <div className="flex flex-col gap-1">
        <div className="flex h-6 items-center justify-between system-sm-semibold text-text-secondary">
          {t(($) => $['detailPanel.toolSelector.toolLabel'], { ns: 'plugin' })}
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
          sideOffset={4}
          trigger={
            <ToolTrigger
              open={panelShowState || isShowChooseTool}
              value={value}
              provider={currentProvider}
            />
          }
          isShow={panelShowState || isShowChooseTool}
          onShowChange={hasTrigger ? onPanelShowStateChange || onShowChange : onShowChange}
          disabled={false}
          supportAddCustomTool
          onSelect={onSelectTool}
          onSelectMultiple={onSelectMultipleTool}
          scope={resolveToolPickerScope(scope)}
          selectedTools={selectedTools}
        />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex h-6 items-center system-sm-semibold text-text-secondary">
          {t(($) => $['detailPanel.toolSelector.descriptionLabel'], { ns: 'plugin' })}
        </div>
        <Textarea
          className="resize-none"
          aria-label={t(($) => $['detailPanel.toolSelector.descriptionLabel'], { ns: 'plugin' })}
          placeholder={t(($) => $['detailPanel.toolSelector.descriptionPlaceholder'], {
            ns: 'plugin',
          })}
          value={value?.extra?.description || ''}
          onValueChange={onDescriptionChange}
          disabled={!value?.provider_name}
        />
      </div>
    </div>
  )
}
