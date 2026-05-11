import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { noop } from 'es-toolkit/function'
import {
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import MetadataTrigger from '../metadata-trigger'
import MetadataFilterSelector from './metadata-filter-selector'

type MetadataFilterProps = {
  metadataFilterMode?: MetadataFilteringModeEnum
  handleMetadataFilterModeChange: (mode: MetadataFilteringModeEnum) => void
} & MetadataShape
const MetadataFilter = ({
  metadataFilterMode = MetadataFilteringModeEnum.disabled,
  handleMetadataFilterModeChange,
  metadataModelConfig,
  handleMetadataModelChange,
  handleMetadataCompletionParamsChange,
  ...restProps
}: MetadataFilterProps) => {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(true)

  const handleMetadataFilterModeChangeWrapped = useCallback((mode: MetadataFilteringModeEnum) => {
    if (mode === MetadataFilteringModeEnum.automatic)
      setCollapsed(false)

    handleMetadataFilterModeChange(mode)
  }, [handleMetadataFilterModeChange])

  return (
    <Collapse
      disabled={metadataFilterMode === MetadataFilteringModeEnum.disabled || metadataFilterMode === MetadataFilteringModeEnum.manual}
      collapsed={collapsed}
      onCollapse={setCollapsed}
      hideCollapseIcon
      trigger={collapseIcon => (
        <div className="flex grow items-center justify-between pr-4">
          <div className="flex items-center">
            <div className="mr-0.5 system-sm-semibold-uppercase text-text-secondary">
              {t('nodes.knowledgeRetrieval.metadata.title', { ns: 'workflow' })}
            </div>
            <Infotip aria-label={t('nodes.knowledgeRetrieval.metadata.tip', { ns: 'workflow' })} popupClassName="w-[200px]">
              {t('nodes.knowledgeRetrieval.metadata.tip', { ns: 'workflow' })}
            </Infotip>
            {collapseIcon}
          </div>
          <div className="flex items-center">
            <MetadataFilterSelector
              value={metadataFilterMode}
              onSelect={handleMetadataFilterModeChangeWrapped}
            />
            {
              metadataFilterMode === MetadataFilteringModeEnum.manual && (
                <div className="ml-1">
                  <MetadataTrigger {...restProps} />
                </div>
              )
            }
          </div>
        </div>
      )}
    >
      <>
        {
          metadataFilterMode === MetadataFilteringModeEnum.automatic && (
            <>
              <div className="px-4 body-xs-regular text-text-tertiary">
                {t('nodes.knowledgeRetrieval.metadata.options.automatic.desc', { ns: 'workflow' })}
              </div>
              <div className="mt-1 px-4">
                <ModelParameterModal
                  popupClassName="w-[387px]!"
                  isInWorkflow
                  isAdvancedMode={true}
                  provider={metadataModelConfig?.provider || ''}
                  completionParams={metadataModelConfig?.completion_params || { temperature: 0.7 }}
                  modelId={metadataModelConfig?.name || ''}
                  setModel={handleMetadataModelChange || noop}
                  onCompletionParamsChange={handleMetadataCompletionParamsChange || noop}
                  hideDebugWithMultipleModel
                  debugWithMultipleModel={false}
                />
              </div>
            </>
          )
        }
      </>
    </Collapse>
  )
}

export default MetadataFilter
