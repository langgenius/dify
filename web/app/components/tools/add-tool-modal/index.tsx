'use client'
import type { FC } from 'react'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import produce from 'immer'
import {
  RiAddLine,
  RiCloseLine,
} from '@remixicon/react'
import { useMount } from 'ahooks'
import type { Collection, CustomCollectionBackend, Tool } from '../types'
import Type from './type'
import Category from './category'
import Tools from './tools'
import cn from '@/utils/classnames'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import Drawer from '@/app/components/base/drawer'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import SearchInput from '@/app/components/base/search-input'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import {
  createCustomCollection,
  fetchAllBuiltInTools,
  fetchAllCustomTools,
  fetchAllWorkflowTools,
  removeBuiltInToolCredential,
  updateBuiltInToolCredential,
} from '@/service/tools'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import Toast from '@/app/components/base/toast'
import ConfigContext from '@/context/debug-configuration'
import type { ModelConfig } from '@/models/debug'

type Props = {
  onHide: () => void
}
// Add and Edit
const AddToolModal: FC<Props> = ({
  onHide,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const [currentType, setCurrentType] = useState('builtin')
  const [currentCategory, setCurrentCategory] = useState('')
  const [keywords, setKeywords] = useState<string>('')
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
  }
  const [toolList, setToolList] = useState<ToolWithProvider[]>([])
  const [listLoading, setListLoading] = useState(true)
  const getAllTools = async () => {
    setListLoading(true)
    const buildInTools = await fetchAllBuiltInTools()
    const customTools = await fetchAllCustomTools()
    const workflowTools = await fetchAllWorkflowTools()
    const mergedToolList = [
      ...buildInTools,
      ...customTools,
      ...workflowTools.filter((toolWithProvider) => {
        return !toolWithProvider.tools.some((tool) => {
          return !!tool.parameters.find(item => item.name === '__image')
        })
      }),
    ]
    setToolList(mergedToolList)
    setListLoading(false)
  }
  const filteredList = useMemo(() => {
    return toolList.filter((toolWithProvider) => {
      if (currentType === 'all')
        return true
      else
        return toolWithProvider.type === currentType
    }).filter((toolWithProvider) => {
      if (!currentCategory)
        return true
      else
        return toolWithProvider.labels.includes(currentCategory)
    }).filter((toolWithProvider) => {
      return toolWithProvider.tools.some((tool) => {
        return Object.values(tool.label).some((label) => {
          return label.toLowerCase().includes(keywords.toLowerCase())
        })
      })
    })
  }, [currentType, currentCategory, toolList, keywords, language])

  const {
    modelConfig,
    setModelConfig,
  } = useContext(ConfigContext)

  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)
  const doCreateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await createCustomCollection(data)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
    getAllTools()
  }
  const [showSettingAuth, setShowSettingAuth] = useState(false)
  const [collection, setCollection] = useState<Collection>()
  const toolSelectHandle = (collection: Collection, tool: Tool) => {
    const parameters: Record<string, string> = {}
    if (tool.parameters) {
      tool.parameters.forEach((item) => {
        parameters[item.name] = ''
      })
    }

    const nexModelConfig = produce(modelConfig, (draft: ModelConfig) => {
      draft.agentConfig.tools.push({
        provider_id: collection.id || collection.name,
        provider_type: collection.type,
        provider_name: collection.name,
        tool_name: tool.name,
        tool_label: tool.label[locale] || tool.label[locale.replaceAll('-', '_')],
        tool_parameters: parameters,
        enabled: true,
      })
    })
    setModelConfig(nexModelConfig)
  }
  const authSelectHandle = (provider: Collection) => {
    setCollection(provider)
    setShowSettingAuth(true)
  }
  const updateBuiltinAuth = async (value: Record<string, any>) => {
    if (!collection)
      return
    await updateBuiltInToolCredential(collection.name, value)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    await getAllTools()
    setShowSettingAuth(false)
  }
  const removeBuiltinAuth = async () => {
    if (!collection)
      return
    await removeBuiltInToolCredential(collection.name)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    await getAllTools()
    setShowSettingAuth(false)
  }

  useMount(() => {
    getAllTools()
  })

  return (
    <>
      <Drawer
        isOpen
        mask
        clickOutsideNotOpen
        onClose={onHide}
        footer={null}
        panelClassname={cn('mt-16 mx-2 sm:mr-2 mb-3 !p-0 rounded-xl', 'mt-2 !w-[640px]', '!max-w-[640px]')}
      >
        <div
          className='w-full flex bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl'
          style={{
            height: 'calc(100vh - 16px)',
          }}
        >
          <div className='relative shrink-0 w-[200px] pb-3 bg-gray-100 rounded-l-xl border-r-[0.5px] border-black/2 overflow-y-auto'>
            <div className='sticky top-0 left-0 right-0'>
              <div className='sticky top-0 left-0 right-0 px-5 py-3 text-md font-semibold text-gray-900'>{t('tools.addTool')}</div>
              <div className='px-3 pt-2 pb-4'>
                <Button variant='primary' className='w-[176px]' onClick={() => setIsShowEditCustomCollectionModal(true)}>
                  <RiAddLine className='w-4 h-4 mr-1' />
                  {t('tools.createCustomTool')}
                </Button>
              </div>
            </div>
            <div className='px-2 py-1'>
              <Type value={currentType} onSelect={setCurrentType} />
              <Category value={currentCategory} onSelect={setCurrentCategory} />
            </div>
          </div>
          <div className='relative grow bg-white rounded-r-xl overflow-y-auto'>
            <div className='z-10 sticky top-0 left-0 right-0 p-2 flex items-center gap-1 bg-white'>
              <div className='grow'>
                <SearchInput className='w-full' value={keywords} onChange={handleKeywordsChange} />
              </div>
              <div className='ml-2 mr-1 w-[1px] h-4 bg-gray-200'></div>
              <div className='p-2 cursor-pointer' onClick={onHide}>
                <RiCloseLine className='w-4 h-4 text-gray-500' />
              </div>
            </div>
            {listLoading && (
              <div className='flex h-[200px] items-center justify-center bg-white'>
                <Loading />
              </div>
            )}
            {!listLoading && (
              <Tools
                showWorkflowEmpty={currentType === 'workflow'}
                tools={filteredList}
                addedTools={(modelConfig?.agentConfig?.tools as any) || []}
                onSelect={toolSelectHandle}
                onAuthSetup={authSelectHandle}
              />
            )}
          </div>
        </div>
      </Drawer>
      {isShowEditCollectionToolModal && (
        <EditCustomToolModal
          positionLeft
          payload={null}
          onHide={() => setIsShowEditCustomCollectionModal(false)}
          onAdd={doCreateCustomToolCollection}
        />
      )}
      {showSettingAuth && collection && (
        <ConfigCredential
          collection={collection}
          onCancel={() => setShowSettingAuth(false)}
          onSaved={updateBuiltinAuth}
          onRemove={removeBuiltinAuth}
        />
      )}
    </>

  )
}
export default React.memo(AddToolModal)
