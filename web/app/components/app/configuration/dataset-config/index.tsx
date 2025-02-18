'use client'
import type { FC } from 'react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce from 'immer'
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
            <div className='text-text-tertiary pb-1 pt-2 text-xs'>{t('appDebug.feature.dataSet.noData')}</div>
          </div>
        )}

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
