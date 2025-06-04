import type { FC } from 'react'
import {
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { memo } from 'react'
import { useBoolean } from 'ahooks'
import type { DataSourceNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  BoxGroupField,
  Group,
  GroupField,
} from '@/app/components/workflow/nodes/_base/components/layout'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import TagInput from '@/app/components/base/tag-input'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useConfig } from './hooks/use-config'
import { OUTPUT_VARIABLES_MAP } from './constants'
import { useStore } from '@/app/components/workflow/store'
import Button from '@/app/components/base/button'
import ConfigCredential from './components/config-credential'
import InputVarList from '@/app/components/workflow/nodes/tool/components/input-var-list'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import type { Var } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import { useToastContext } from '@/app/components/base/toast'
import { useUpdateDataSourceCredentials } from '@/service/use-pipeline'

const Panel: FC<NodePanelProps<DataSourceNodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { nodesReadOnly } = useNodesReadOnly()
  const dataSourceList = useStore(s => s.dataSourceList)
  const {
    provider_type,
    provider_id,
    fileExtensions = [],
    datasource_parameters,
  } = data
  const {
    handleFileExtensionsChange,
    handleParametersChange,
  } = useConfig(id)
  const isLocalFile = provider_type === 'local_file'
  const currentDataSource = dataSourceList?.find(ds => ds.plugin_id === provider_id)
  const isAuthorized = !!currentDataSource?.is_authorized
  const [showAuthModal, {
    setTrue: openAuthModal,
    setFalse: hideAuthModal,
  }] = useBoolean(false)
  const currentDataSourceItem: any = currentDataSource?.tools.find(tool => tool.name === data.datasource_name)
  const formSchemas = useMemo(() => {
    return currentDataSourceItem ? toolParametersToFormSchemas(currentDataSourceItem.parameters) : []
  }, [currentDataSourceItem])
  const [currVarIndex, setCurrVarIndex] = useState(-1)
  const currVarType = formSchemas[currVarIndex]?._type
  const handleOnVarOpen = useCallback((index: number) => {
    setCurrVarIndex(index)
  }, [])

  const filterVar = useCallback((varPayload: Var) => {
    if (currVarType)
      return varPayload.type === currVarType

    return varPayload.type !== VarType.arrayFile
  }, [currVarType])

  const { mutateAsync } = useUpdateDataSourceCredentials()
  const handleAuth = useCallback(async (value: any) => {
    await mutateAsync({
      provider: currentDataSourceItem?.provider,
      pluginId: currentDataSourceItem?.plugin_id,
      credentials: value,
    })

    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    hideAuthModal()
  }, [currentDataSourceItem, mutateAsync, notify, t, hideAuthModal])

  return (
    <div >
      {
        !isAuthorized && !showAuthModal && (
          <Group>
            <Button
              variant='primary'
              className='w-full'
              onClick={openAuthModal}
              disabled={nodesReadOnly}
            >
              {t('workflow.nodes.tool.authorize')}
            </Button>
          </Group>
        )
      }
      {
        isAuthorized && (
          <GroupField
            groupProps={{
              withBorderBottom: true,
            }}
          >
            <InputVarList
              readOnly={nodesReadOnly}
              nodeId={id}
              schema={formSchemas as any}
              filterVar={filterVar}
              value={datasource_parameters}
              onChange={handleParametersChange}
              isSupportConstantValue
              onOpen={handleOnVarOpen}
            />
          </GroupField>
        )
      }
      {
        isLocalFile && (
          <BoxGroupField
            boxGroupProps={{
              boxProps: { withBorderBottom: true },
            }}
            fieldProps={{
              fieldTitleProps: {
                title: t('workflow.nodes.dataSource.supportedFileFormats'),
              },
            }}
          >
            <div className='rounded-lg bg-components-input-bg-normal p-1 pt-0'>
              <TagInput
                items={fileExtensions}
                onChange={handleFileExtensionsChange}
                placeholder={t('workflow.nodes.dataSource.supportedFileFormatsPlaceholder')}
                inputClassName='bg-transparent'
                disableAdd={nodesReadOnly}
                disableRemove={nodesReadOnly}
              />
            </div>
          </BoxGroupField>
        )
      }
      <OutputVars>
        <VarItem
          name={OUTPUT_VARIABLES_MAP.datasource_type.name}
          type={OUTPUT_VARIABLES_MAP.datasource_type.type}
          description={OUTPUT_VARIABLES_MAP.datasource_type.description}
        />
        {
          isLocalFile && (
            <VarItem
              name={OUTPUT_VARIABLES_MAP.file.name}
              type={OUTPUT_VARIABLES_MAP.file.type}
              description={OUTPUT_VARIABLES_MAP.file.description}
              subItems={OUTPUT_VARIABLES_MAP.file.subItems.map(item => ({
                name: item.name,
                type: item.type,
                description: item.description,
              }))}
            />
          )
        }
      </OutputVars>
      {
        showAuthModal && (
          <ConfigCredential
            dataSourceItem={currentDataSource!}
            onCancel={hideAuthModal}
            onSaved={handleAuth}
            isHideRemoveBtn
          />
        )
      }
    </div>
  )
}

export default memo(Panel)
