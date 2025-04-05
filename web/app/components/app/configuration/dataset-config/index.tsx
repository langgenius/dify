'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { intersectionBy } from 'lodash-es'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import { v4 as uuid4 } from 'uuid'
import { useFormattingChangedDispatcher } from '../debug/hooks'
import FeaturePanel from '../base/feature-panel'
import OperationBtn from '../base/operation-btn'
import CardItem from './card-item/item'
import ParamsConfig from './params-config'
import ContextVar from './context-var'
import ConfigContext from '@/context/debug-configuration'
import { AppType } from '@/types/app'
import type { DataSet } from '@/models/datasets'
import {
  getMultipleRetrievalConfig,
  getSelectedDatasetsMode,
} from '@/app/components/workflow/nodes/knowledge-retrieval/utils'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { hasEditPermissionForDataset } from '@/utils/permission'
import MetadataFilter from '@/app/components/workflow/nodes/knowledge-retrieval/components/metadata/metadata-filter'
import type {
  HandleAddCondition,
  HandleRemoveCondition,
  HandleToggleConditionLogicalOperator,
  HandleUpdateCondition,
  MetadataFilteringModeEnum,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'

const DatasetConfig: FC = () => {
  const { t } = useTranslation()
  const userProfile = useAppContextSelector(s => s.userProfile)
  const {
    mode,
    dataSets: dataSet,
    setDataSets: setDataSet,
    modelConfig,
    setModelConfig,
    showSelectDataSet,
    isAgent,
    datasetConfigs,
    datasetConfigsRef,
    setDatasetConfigs,
    setRerankSettingModalOpen,
  } = useContext(ConfigContext)
  const formattingChangedDispatcher = useFormattingChangedDispatcher()

  const hasData = dataSet.length > 0

  const {
    currentModel: currentRerankModel,
    currentProvider: currentRerankProvider,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)

  const onRemove = (id: string) => {
    const filteredDataSets = dataSet.filter(item => item.id !== id)
    setDataSet(filteredDataSets)
    const retrievalConfig = getMultipleRetrievalConfig(datasetConfigs as any, filteredDataSets, dataSet, {
      provider: currentRerankProvider?.provider,
      model: currentRerankModel?.model,
    })
    setDatasetConfigs({
      ...(datasetConfigs as any),
      ...retrievalConfig,
    })
    const {
      allExternal,
      allInternal,
      mixtureInternalAndExternal,
      mixtureHighQualityAndEconomic,
      inconsistentEmbeddingModel,
    } = getSelectedDatasetsMode(filteredDataSets)

    if (
      (allInternal && (mixtureHighQualityAndEconomic || inconsistentEmbeddingModel))
      || mixtureInternalAndExternal
      || allExternal
    )
      setRerankSettingModalOpen(true)
    formattingChangedDispatcher()
  }

  const handleSave = (newDataset: DataSet) => {
    const index = dataSet.findIndex(item => item.id === newDataset.id)

    const newDatasets = [...dataSet.slice(0, index), newDataset, ...dataSet.slice(index + 1)]
    setDataSet(newDatasets)
    formattingChangedDispatcher()
  }

  const promptVariables = modelConfig.configs.prompt_variables
  const promptVariablesToSelect = promptVariables.map(item => ({
    name: item.name,
    type: item.type,
    value: item.key,
  }))
  const selectedContextVar = promptVariables?.find(item => item.is_context_var)
  const handleSelectContextVar = (selectedValue: string) => {
    const newModelConfig = produce(modelConfig, (draft) => {
      draft.configs.prompt_variables = modelConfig.configs.prompt_variables.map((item) => {
        return ({
          ...item,
          is_context_var: item.key === selectedValue,
        })
      })
    })
    setModelConfig(newModelConfig)
  }

  const formattedDataset = useMemo(() => {
    return dataSet.map((item) => {
      const datasetConfig = {
        createdBy: item.created_by,
        partialMemberList: item.partial_member_list || [],
        permission: item.permission,
      }
      return {
        ...item,
        editable: hasEditPermissionForDataset(userProfile?.id || '', datasetConfig),
      }
    })
  }, [dataSet, userProfile?.id])

  const metadataList = useMemo(() => {
    return intersectionBy(...formattedDataset.filter((dataset) => {
      return !!dataset.doc_metadata
    }).map((dataset) => {
      return dataset.doc_metadata!
    }), 'name')
  }, [formattedDataset])

  const handleMetadataFilterModeChange = useCallback((newMode: MetadataFilteringModeEnum) => {
    setDatasetConfigs(produce(datasetConfigsRef.current!, (draft) => {
      draft.metadata_filtering_mode = newMode
    }))
  }, [setDatasetConfigs, datasetConfigsRef])

  const handleAddCondition = useCallback<HandleAddCondition>(({ name, type }) => {
    let operator: ComparisonOperator = ComparisonOperator.is

    if (type === MetadataFilteringVariableType.number)
      operator = ComparisonOperator.equal

    const newCondition = {
      id: uuid4(),
      name,
      comparison_operator: operator,
    }

    const newInputs = produce(datasetConfigsRef.current!, (draft) => {
      if (draft.metadata_filtering_conditions) {
        draft.metadata_filtering_conditions.conditions.push(newCondition)
      }
      else {
        draft.metadata_filtering_conditions = {
          logical_operator: LogicalOperator.and,
          conditions: [newCondition],
        }
      }
    })
    setDatasetConfigs(newInputs)
  }, [setDatasetConfigs, datasetConfigsRef])

  const handleRemoveCondition = useCallback<HandleRemoveCondition>((id) => {
    const conditions = datasetConfigsRef.current!.metadata_filtering_conditions?.conditions || []
    const index = conditions.findIndex(c => c.id === id)
    const newInputs = produce(datasetConfigsRef.current!, (draft) => {
      if (index > -1)
        draft.metadata_filtering_conditions?.conditions.splice(index, 1)
    })
    setDatasetConfigs(newInputs)
  }, [setDatasetConfigs, datasetConfigsRef])

  const handleUpdateCondition = useCallback<HandleUpdateCondition>((id, newCondition) => {
    const conditions = datasetConfigsRef.current!.metadata_filtering_conditions?.conditions || []
    const index = conditions.findIndex(c => c.id === id)
    const newInputs = produce(datasetConfigsRef.current!, (draft) => {
      if (index > -1)
        draft.metadata_filtering_conditions!.conditions[index] = newCondition
    })
    setDatasetConfigs(newInputs)
  }, [setDatasetConfigs, datasetConfigsRef])

  const handleToggleConditionLogicalOperator = useCallback<HandleToggleConditionLogicalOperator>(() => {
    const oldLogicalOperator = datasetConfigsRef.current!.metadata_filtering_conditions?.logical_operator
    const newLogicalOperator = oldLogicalOperator === LogicalOperator.and ? LogicalOperator.or : LogicalOperator.and
    const newInputs = produce(datasetConfigsRef.current!, (draft) => {
      draft.metadata_filtering_conditions!.logical_operator = newLogicalOperator
    })
    setDatasetConfigs(newInputs)
  }, [setDatasetConfigs, datasetConfigsRef])

  const handleMetadataModelChange = useCallback((model: { provider: string; modelId: string; mode?: string }) => {
    const newInputs = produce(datasetConfigsRef.current!, (draft) => {
      draft.metadata_model_config = {
        provider: model.provider,
        name: model.modelId,
        mode: model.mode || 'chat',
        completion_params: draft.metadata_model_config?.completion_params || { temperature: 0.7 },
      }
    })
    setDatasetConfigs(newInputs)
  }, [setDatasetConfigs, datasetConfigsRef])

  const handleMetadataCompletionParamsChange = useCallback((newParams: Record<string, any>) => {
    const newInputs = produce(datasetConfigsRef.current!, (draft) => {
      draft.metadata_model_config = {
        ...draft.metadata_model_config!,
        completion_params: newParams,
      }
    })
    setDatasetConfigs(newInputs)
  }, [setDatasetConfigs, datasetConfigsRef])

  return (
    <FeaturePanel
      className='mt-2'
      title={t('appDebug.feature.dataSet.title')}
      headerRight={
        <div className='flex items-center gap-1'>
          {!isAgent && <ParamsConfig disabled={!hasData} selectedDatasets={dataSet} />}
          <OperationBtn type="add" onClick={showSelectDataSet} />
        </div>
      }
      hasHeaderBottomBorder={!hasData}
      noBodySpacing
    >
      {hasData
        ? (
          <div className='mt-1 flex flex-wrap justify-between px-3 pb-3'>
            {formattedDataset.map(item => (
              <CardItem
                key={item.id}
                config={item}
                onRemove={onRemove}
                onSave={handleSave}
                editable={item.editable}
              />
            ))}
          </div>
        )
        : (
          <div className='mt-1 px-3 pb-3'>
            <div className='pb-1 pt-2 text-xs text-text-tertiary'>{t('appDebug.feature.dataSet.noData')}</div>
          </div>
        )}

      <div className='border-t border-t-divider-subtle py-2'>
        <MetadataFilter
          metadataList={metadataList}
          selectedDatasetsLoaded
          metadataFilterMode={datasetConfigs.metadata_filtering_mode}
          metadataFilteringConditions={datasetConfigs.metadata_filtering_conditions}
          handleAddCondition={handleAddCondition}
          handleMetadataFilterModeChange={handleMetadataFilterModeChange}
          handleRemoveCondition={handleRemoveCondition}
          handleToggleConditionLogicalOperator={handleToggleConditionLogicalOperator}
          handleUpdateCondition={handleUpdateCondition}
          metadataModelConfig={datasetConfigs.metadata_model_config}
          handleMetadataModelChange={handleMetadataModelChange}
          handleMetadataCompletionParamsChange={handleMetadataCompletionParamsChange}
          isCommonVariable
          availableCommonStringVars={promptVariablesToSelect.filter(item => item.type === MetadataFilteringVariableType.string)}
          availableCommonNumberVars={promptVariablesToSelect.filter(item => item.type === MetadataFilteringVariableType.number)}
        />
      </div>

      {mode === AppType.completion && dataSet.length > 0 && (
        <ContextVar
          value={selectedContextVar?.key}
          options={promptVariablesToSelect}
          onChange={handleSelectContextVar}
        />
      )}
    </FeaturePanel>
  )
}
export default React.memo(DatasetConfig)
