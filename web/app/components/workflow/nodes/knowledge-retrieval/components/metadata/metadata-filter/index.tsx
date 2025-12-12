import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import MetadataTrigger from '../metadata-trigger'
import MetadataFilterSelector from './metadata-filter-selector'
import Collapse from '@/app/components/workflow/nodes/_base/components/collapse'
import Tooltip from '@/app/components/base/tooltip'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import type { MetadataShape } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { CredentialOverride } from '@/app/components/workflow/nodes/llm/types'
import type { ModelConfig } from '@/app/components/workflow/types'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { noop } from 'lodash-es'
import { SimpleSelect } from '@/app/components/base/select'
import type { Item as SelectItem } from '@/app/components/base/select'
import useSWR from 'swr'
import { fetchAvailableCredentials } from '@/service/common'

// Enhanced ModelConfig with credential_override support
type ModelConfigWithCredential = ModelConfig & {
  credential_override?: CredentialOverride
}

type MetadataFilterProps = {
  metadataFilterMode?: MetadataFilteringModeEnum
  handleMetadataFilterModeChange: (mode: MetadataFilteringModeEnum) => void
  handleMetadataCredentialOverrideChange?: (override?: CredentialOverride) => void
  readOnly?: boolean
} & Omit<MetadataShape, 'metadataModelConfig'> & {
  metadataModelConfig?: ModelConfigWithCredential
}
const MetadataFilter = ({
  metadataFilterMode = MetadataFilteringModeEnum.disabled,
  handleMetadataFilterModeChange,
  metadataModelConfig,
  handleMetadataModelChange,
  handleMetadataCompletionParamsChange,
  handleMetadataCredentialOverrideChange,
  readOnly = false,
  ...restProps
}: MetadataFilterProps) => {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(true)

  const handleMetadataFilterModeChangeWrapped = useCallback((mode: MetadataFilteringModeEnum) => {
    if (mode === MetadataFilteringModeEnum.automatic)
      setCollapsed(false)

    handleMetadataFilterModeChange(mode)
  }, [handleMetadataFilterModeChange])

  // available credentials for override select (for metadata model)
  const metadataProvider = metadataModelConfig?.provider
  const metadataModelName = metadataModelConfig?.name
  const { data: metadataAvailableCreds, isLoading: metadataCredsLoading } = useSWR(
    metadataProvider ? `/workspaces/current/model-providers/${metadataProvider}/available-credentials${metadataModelName ? `?model=${encodeURIComponent(metadataModelName)}&model_type=llm` : ''}` : null,
    fetchAvailableCredentials,
  )
  const metadataOverrideItems: SelectItem[] = useMemo(() => {
    const list = [
      ...((metadataAvailableCreds?.provider_available_credentials || []).map(c => ({ value: c.credential_id, name: c.credential_name || c.credential_id })) as SelectItem[]),
      ...((metadataAvailableCreds?.model_available_credentials || []).map(c => ({ value: c.credential_id, name: c.credential_name || c.credential_id })) as SelectItem[]),
    ]
    const seen = new Set<string>()
    const deduped = list.filter((it) => {
      const v = String(it.value)
      if (seen.has(v)) return false
      seen.add(v)
      return true
    })
    // Add explicit option label to allow resetting to default credentials
    return [{ value: '', name: t('common.label.noOverride') }, ...deduped]
  }, [metadataAvailableCreds, t])

  return (
    <Collapse
      disabled={metadataFilterMode === MetadataFilteringModeEnum.disabled || metadataFilterMode === MetadataFilteringModeEnum.manual}
      collapsed={collapsed}
      onCollapse={setCollapsed}
      hideCollapseIcon
      trigger={collapseIcon => (
        <div className='flex grow items-center justify-between pr-4'>
          <div className='flex items-center'>
            <div className='system-sm-semibold-uppercase mr-0.5 text-text-secondary'>
              {t('workflow.nodes.knowledgeRetrieval.metadata.title')}
            </div>
            <Tooltip
              popupContent={(
                <div className='w-[200px]'>
                  {t('workflow.nodes.knowledgeRetrieval.metadata.tip')}
                </div>
              )}
            />
            {collapseIcon}
          </div>
          <div className='flex items-center'>
            <MetadataFilterSelector
              value={metadataFilterMode}
              onSelect={handleMetadataFilterModeChangeWrapped}
            />
            {
              metadataFilterMode === MetadataFilteringModeEnum.manual && (
                <div className='ml-1'>
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
              <div className='body-xs-regular px-4 text-text-tertiary'>
                {t('workflow.nodes.knowledgeRetrieval.metadata.options.automatic.desc')}
              </div>
              <div className='mt-1 px-4'>
                <ModelParameterModal
                  portalToFollowElemContentClassName='z-[50]'
                  popupClassName='!w-[387px]'
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
                {metadataModelConfig?.provider && !readOnly && (
                  <div className='mt-3'>
                    <Field
                      title={t('API keys')}
                      tooltip={t('workflow.nodes.knowledgeRetrieval metadata credential override')!}
                    >
                      <div className='space-y-2'>
                        <SimpleSelect
                          items={metadataOverrideItems}
                          defaultValue={metadataModelConfig?.credential_override?.credential_id || ''}
                          onSelect={(item) => {
                            const v = String(item.value || '')
                            handleMetadataCredentialOverrideChange?.(v
                              ? { credential_id: v, credential_name: undefined }
                              : undefined,
                            )
                          }}
                          isLoading={metadataCredsLoading}
                          notClearable={false}
                          className="system-sm-regular h-8 w-full items-center justify-between rounded-lg bg-components-input-bg-normal px-2 hover:bg-state-base-hover-alt"
                          wrapperClassName="h-8"
                          optionClassName="system-sm-regular"
                        />
                        <div className='text-xs text-text-tertiary'>
                          {t('override the credential')}
                        </div>
                      </div>
                    </Field>
                  </div>
                )}
              </div>
            </>
          )
        }
      </>
    </Collapse>
  )
}

export default MetadataFilter
