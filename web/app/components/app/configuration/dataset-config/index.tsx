'use client'
import type { FC } from 'react'
import React from 'react'
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

const Icon = (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M12.6667 5.34368C12.6667 5.32614 12.6667 5.31738 12.6659 5.30147C12.6502 4.97229 12.3607 4.68295 12.0315 4.66737C12.0156 4.66662 12.0104 4.66662 12 4.66663H9.8391C9.30248 4.66662 8.85957 4.66661 8.49878 4.69609C8.12405 4.72671 7.77958 4.79242 7.45603 4.95728C6.95426 5.21294 6.54631 5.62089 6.29065 6.12265C6.12579 6.44621 6.06008 6.79068 6.02946 7.16541C5.99999 7.5262 5.99999 7.96911 6 8.50574V15.4942C5.99999 16.0308 5.99999 16.4737 6.02946 16.8345C6.06008 17.2092 6.12579 17.5537 6.29065 17.8773C6.54631 18.379 6.95426 18.787 7.45603 19.0426C7.77958 19.2075 8.12405 19.2732 8.49878 19.3038C8.85958 19.3333 9.30248 19.3333 9.83912 19.3333H14.1609C14.6975 19.3333 15.1404 19.3333 15.5012 19.3038C15.8759 19.2732 16.2204 19.2075 16.544 19.0426C17.0457 18.787 17.4537 18.379 17.7093 17.8773C17.8742 17.5537 17.9399 17.2092 17.9705 16.8345C18 16.4737 18 16.0308 18 15.4942V10.6666C18 10.6562 18 10.6511 17.9993 10.6352C17.9837 10.306 17.6943 10.0164 17.3651 10.0007C17.3492 9.99997 17.3405 9.99997 17.323 9.99997L14.3787 9.99997C14.2105 9.99999 14.0466 10 13.9078 9.98867C13.7555 9.97622 13.5756 9.94684 13.3947 9.85464C13.1438 9.72681 12.9398 9.52284 12.812 9.27195C12.7198 9.09101 12.6904 8.91118 12.678 8.75879C12.6666 8.62001 12.6666 8.45615 12.6667 8.2879L12.6667 5.34368ZM9.33333 12.6666C8.96514 12.6666 8.66667 12.9651 8.66667 13.3333C8.66667 13.7015 8.96514 14 9.33333 14H14.6667C15.0349 14 15.3333 13.7015 15.3333 13.3333C15.3333 12.9651 15.0349 12.6666 14.6667 12.6666H9.33333ZM9.33333 15.3333C8.96514 15.3333 8.66667 15.6318 8.66667 16C8.66667 16.3681 8.96514 16.6666 9.33333 16.6666H13.3333C13.7015 16.6666 14 16.3681 14 16C14 15.6318 13.7015 15.3333 13.3333 15.3333H9.33333Z" fill="#6938EF" />
    <path d="M16.6053 8.66662C16.8011 8.66662 16.8989 8.66663 16.9791 8.61747C17.0923 8.54806 17.16 8.38452 17.129 8.25538C17.107 8.16394 17.0432 8.10018 16.9155 7.97265L14.694 5.75111C14.5664 5.62345 14.5027 5.55962 14.4112 5.53764C14.2821 5.5066 14.1186 5.57429 14.0492 5.68752C14 5.7677 14 5.86557 14 6.06132L14 8.13327C14 8.31994 14 8.41328 14.0363 8.48459C14.0683 8.54731 14.1193 8.5983 14.182 8.63026C14.2533 8.66659 14.3466 8.66659 14.5333 8.66659L16.6053 8.66662Z" fill="#6938EF" />
  </svg>
)

const DatasetConfig: FC = () => {
  const { t } = useTranslation()
  const {
    mode,
    dataSets: dataSet,
    setDataSets: setDataSet,
    modelConfig,
    setModelConfig,
    showSelectDataSet,
    isAgent,
  } = useContext(ConfigContext)
  const formattingChangedDispatcher = useFormattingChangedDispatcher()

  const hasData = dataSet.length > 0

  const onRemove = (id: string) => {
    setDataSet(dataSet.filter(item => item.id !== id))
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

  return (
    <FeaturePanel
      className='mt-3'
      headerIcon={Icon}
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
          <div className='flex flex-wrap mt-1 px-3 pb-3 justify-between'>
            {dataSet.map(item => (
              <CardItem
                key={item.id}
                config={item}
                onRemove={onRemove}
                onSave={handleSave}
              />
            ))}
          </div>
        )
        : (
          <div className='mt-1 px-3 pb-3'>
            <div className='pt-2 pb-1 text-xs text-gray-500'>{t('appDebug.feature.dataSet.noData')}</div>
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
