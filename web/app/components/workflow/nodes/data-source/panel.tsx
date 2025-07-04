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
import { DataSourceClassification } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import {
  BoxGroupField,
  Group,
} from '@/app/components/workflow/nodes/_base/components/layout'
import OutputVars, { VarItem } from '@/app/components/workflow/nodes/_base/components/output-vars'
import TagInput from '@/app/components/base/tag-input'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import { useConfig } from './hooks/use-config'
import {
  COMMON_OUTPUT,
  LOCAL_FILE_OUTPUT,
  ONLINE_DOCUMENT_OUTPUT,
  ONLINE_DRIVE_OUTPUT,
  WEBSITE_CRAWL_OUTPUT,
} from './constants'
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
    plugin_id,
    fileExtensions = [],
    datasource_parameters,
  } = data
  const {
    handleFileExtensionsChange,
    handleParametersChange,
  } = useConfig(id)
  const isLocalFile = provider_type === DataSourceClassification.localFile
  const isWebsiteCrawl = provider_type === DataSourceClassification.websiteCrawl
  const isOnlineDocument = provider_type === DataSourceClassification.onlineDocument
  const isOnlineDrive = provider_type === DataSourceClassification.onlineDrive
  const currentDataSource = dataSourceList?.find(ds => ds.plugin_id === plugin_id)
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
      provider: currentDataSource?.provider || '',
      pluginId: currentDataSource?.plugin_id || '',
      credentials: value,
      name: 'd14249c6-abe3-47ad-b0f1-1e65a591e790', // todo: fake name field, need to be removed later
    })

    notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    hideAuthModal()
  }, [currentDataSource, mutateAsync, notify, t, hideAuthModal])

  return (
    <div >
      {
        !isAuthorized && !showAuthModal && !isLocalFile && currentDataSource && (
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
        isAuthorized && !isLocalFile && !!formSchemas?.length && (
          <BoxGroupField
            boxGroupProps={{
              boxProps: { withBorderBottom: true },
            }}
            fieldProps={{
              fieldTitleProps: {
                title: t('workflow.nodes.tool.inputVars'),
              },
              supportCollapse: true,
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
          </BoxGroupField>
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
        {
          COMMON_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
            />
          ))
        }
        {
          isLocalFile && LOCAL_FILE_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
              subItems={item.subItems.map(item => ({
                name: item.name,
                type: item.type,
                description: item.description,
              }))}
            />
          ))
        }
        {
          isWebsiteCrawl && WEBSITE_CRAWL_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
            />
          ))
        }
        {
          isOnlineDocument && ONLINE_DOCUMENT_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
            />
          ))
        }
        {
          isOnlineDrive && ONLINE_DRIVE_OUTPUT.map((item, index) => (
            <VarItem
              key={index}
              name={item.name}
              type={item.type}
              description={item.description}
              subItems={item.subItems.map(item => ({
                name: item.name,
                type: item.type,
                description: item.description,
              }))}
            />
          ))
        }
      </OutputVars>
      {
        showAuthModal && !isLocalFile && (
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
