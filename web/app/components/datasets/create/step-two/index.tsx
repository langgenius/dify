'use client'
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useBoolean } from 'ahooks'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { RocketLaunchIcon } from '@heroicons/react/24/outline'
import {
  RiCloseLine,
} from '@remixicon/react'
import Link from 'next/link'
import { groupBy } from 'lodash-es'
import PreviewItem, { PreviewType } from './preview-item'
import LanguageSelect from './language-select'
import s from './index.module.css'
import unescape from './unescape'
import escape from './escape'
import cn from '@/utils/classnames'
import type { CrawlOptions, CrawlResultItem, CreateDocumentReq, CustomFile, FileIndexingEstimateResponse, FullDocumentDetail, IndexingEstimateParams, NotionInfo, PreProcessingRule, ProcessRule, Rules, createDocumentResponse } from '@/models/datasets'
import {
  createDocument,
  createFirstDocument,
  fetchFileIndexingEstimate as didFetchFileIndexingEstimate,
  fetchDefaultProcessRule,
} from '@/service/datasets'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import FloatRightContainer from '@/app/components/base/float-right-container'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import { type RetrievalConfig } from '@/types/app'
import { ensureRerankModelSelected, isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import Toast from '@/app/components/base/toast'
import { formatNumber } from '@/utils/format'
import type { NotionPage } from '@/models/common'
import { DataSourceProvider } from '@/models/common'
import { DataSourceType, DocForm } from '@/models/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import Switch from '@/app/components/base/switch'
import { MessageChatSquare } from '@/app/components/base/icons/src/public/common'
import { useDatasetDetailContext } from '@/context/dataset-detail'
import I18n from '@/context/i18n'
import { IS_CE_EDITION } from '@/config'
import { RETRIEVE_METHOD } from '@/types/app'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import Tooltip from '@/app/components/base/tooltip'
import { useDefaultModel, useModelList, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { LanguagesSupported } from '@/i18n/language'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Globe01 } from '@/app/components/base/icons/src/vender/line/mapsAndTravel'

type ValueOf<T> = T[keyof T]
type StepTwoProps = {
  isSetting?: boolean
  documentDetail?: FullDocumentDetail
  isAPIKeySet: boolean
  onSetting: () => void
  datasetId?: string
  indexingType?: ValueOf<IndexingType>
  dataSourceType: DataSourceType
  files: CustomFile[]
  notionPages?: NotionPage[]
  websitePages?: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider?: DataSourceProvider
  websiteCrawlJobId?: string
  onStepChange?: (delta: number) => void
  updateIndexingTypeCache?: (type: string) => void
  updateResultCache?: (res: createDocumentResponse) => void
  onSave?: () => void
  onCancel?: () => void
}

enum SegmentType {
  AUTO = 'automatic',
  CUSTOM = 'custom',
}
enum IndexingType {
  QUALIFIED = 'high_quality',
  ECONOMICAL = 'economy',
}

const DEFAULT_SEGMENT_IDENTIFIER = '\\n\\n'

const StepTwo = ({
  isSetting,
  documentDetail,
  isAPIKeySet,
  onSetting,
  datasetId,
  indexingType,
  dataSourceType: inCreatePageDataSourceType,
  files,
  notionPages = [],
  websitePages = [],
  crawlOptions,
  websiteCrawlProvider = DataSourceProvider.fireCrawl,
  websiteCrawlJobId = '',
  onStepChange,
  updateIndexingTypeCache,
  updateResultCache,
  onSave,
  onCancel,
}: StepTwoProps) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { dataset: currentDataset, mutateDatasetRes } = useDatasetDetailContext()
  const isInCreatePage = !datasetId || (datasetId && !currentDataset?.data_source_type)
  const dataSourceType = isInCreatePage ? inCreatePageDataSourceType : currentDataset?.data_source_type
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const [previewScrolled, setPreviewScrolled] = useState(false)
  const [segmentationType, setSegmentationType] = useState<SegmentType>(SegmentType.AUTO)
  const [segmentIdentifier, doSetSegmentIdentifier] = useState(DEFAULT_SEGMENT_IDENTIFIER)
  const setSegmentIdentifier = useCallback((value: string) => {
    doSetSegmentIdentifier(value ? escape(value) : DEFAULT_SEGMENT_IDENTIFIER)
  }, [])
  const [max, setMax] = useState(4000) // default chunk length
  const [overlap, setOverlap] = useState(50)
  const [rules, setRules] = useState<PreProcessingRule[]>([])
  const [defaultConfig, setDefaultConfig] = useState<Rules>()
  const hasSetIndexType = !!indexingType
  const [indexType, setIndexType] = useState<ValueOf<IndexingType>>(
    (indexingType
      || isAPIKeySet)
      ? IndexingType.QUALIFIED
      : IndexingType.ECONOMICAL,
  )
  const [docForm, setDocForm] = useState<DocForm | string>(
    (datasetId && documentDetail) ? documentDetail.doc_form : DocForm.TEXT,
  )
  const [docLanguage, setDocLanguage] = useState<string>(
    (datasetId && documentDetail) ? documentDetail.doc_language : (locale !== LanguagesSupported[1] ? 'English' : 'Chinese'),
  )
  const [QATipHide, setQATipHide] = useState(false)
  const [previewSwitched, setPreviewSwitched] = useState(false)
  const [showPreview, { setTrue: setShowPreview, setFalse: hidePreview }] = useBoolean()
  const [customFileIndexingEstimate, setCustomFileIndexingEstimate] = useState<FileIndexingEstimateResponse | null>(null)
  const [automaticFileIndexingEstimate, setAutomaticFileIndexingEstimate] = useState<FileIndexingEstimateResponse | null>(null)

  const fileIndexingEstimate = (() => {
    return segmentationType === SegmentType.AUTO ? automaticFileIndexingEstimate : customFileIndexingEstimate
  })()
  const [isCreating, setIsCreating] = useState(false)

  const scrollHandle = (e: Event) => {
    if ((e.target as HTMLDivElement).scrollTop > 0)
      setScrolled(true)

    else
      setScrolled(false)
  }

  const previewScrollHandle = (e: Event) => {
    if ((e.target as HTMLDivElement).scrollTop > 0)
      setPreviewScrolled(true)

    else
      setPreviewScrolled(false)
  }
  const getFileName = (name: string) => {
    const arr = name.split('.')
    return arr.slice(0, -1).join('.')
  }

  const getRuleName = (key: string) => {
    if (key === 'remove_extra_spaces')
      return t('datasetCreation.stepTwo.removeExtraSpaces')

    if (key === 'remove_urls_emails')
      return t('datasetCreation.stepTwo.removeUrlEmails')

    if (key === 'remove_stopwords')
      return t('datasetCreation.stepTwo.removeStopwords')
  }
  const ruleChangeHandle = (id: string) => {
    const newRules = rules.map((rule) => {
      if (rule.id === id) {
        return {
          id: rule.id,
          enabled: !rule.enabled,
        }
      }
      return rule
    })
    setRules(newRules)
  }
  const resetRules = () => {
    if (defaultConfig) {
      setSegmentIdentifier(defaultConfig.segmentation.separator)
      setMax(defaultConfig.segmentation.max_tokens)
      setOverlap(defaultConfig.segmentation.chunk_overlap)
      setRules(defaultConfig.pre_processing_rules)
    }
  }

  const fetchFileIndexingEstimate = async (docForm = DocForm.TEXT) => {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const res = await didFetchFileIndexingEstimate(getFileIndexingEstimateParams(docForm)!)
    if (segmentationType === SegmentType.CUSTOM)
      setCustomFileIndexingEstimate(res)
    else
      setAutomaticFileIndexingEstimate(res)
  }

  const confirmChangeCustomConfig = () => {
    setCustomFileIndexingEstimate(null)
    setShowPreview()
    fetchFileIndexingEstimate()
    setPreviewSwitched(false)
  }

  const getIndexing_technique = () => indexingType || indexType

  const getProcessRule = () => {
    const processRule: ProcessRule = {
      rules: {} as any, // api will check this. It will be removed after api refactored.
      mode: segmentationType,
    }
    if (segmentationType === SegmentType.CUSTOM) {
      const ruleObj = {
        pre_processing_rules: rules,
        segmentation: {
          separator: unescape(segmentIdentifier),
          max_tokens: max,
          chunk_overlap: overlap,
        },
      }
      processRule.rules = ruleObj
    }
    return processRule
  }

  const getNotionInfo = () => {
    const workspacesMap = groupBy(notionPages, 'workspace_id')
    const workspaces = Object.keys(workspacesMap).map((workspaceId) => {
      return {
        workspaceId,
        pages: workspacesMap[workspaceId],
      }
    })
    return workspaces.map((workspace) => {
      return {
        workspace_id: workspace.workspaceId,
        pages: workspace.pages.map((page) => {
          const { page_id, page_name, page_icon, type } = page
          return {
            page_id,
            page_name,
            page_icon,
            type,
          }
        }),
      }
    }) as NotionInfo[]
  }

  const getWebsiteInfo = () => {
    return {
      provider: websiteCrawlProvider,
      job_id: websiteCrawlJobId,
      urls: websitePages.map(page => page.source_url),
      only_main_content: crawlOptions?.only_main_content,
    }
  }

  const getFileIndexingEstimateParams = (docForm: DocForm): IndexingEstimateParams | undefined => {
    if (dataSourceType === DataSourceType.FILE) {
      return {
        info_list: {
          data_source_type: dataSourceType,
          file_info_list: {
            file_ids: files.map(file => file.id) as string[],
          },
        },
        indexing_technique: getIndexing_technique() as string,
        process_rule: getProcessRule(),
        doc_form: docForm,
        doc_language: docLanguage,
        dataset_id: datasetId as string,
      }
    }
    if (dataSourceType === DataSourceType.NOTION) {
      return {
        info_list: {
          data_source_type: dataSourceType,
          notion_info_list: getNotionInfo(),
        },
        indexing_technique: getIndexing_technique() as string,
        process_rule: getProcessRule(),
        doc_form: docForm,
        doc_language: docLanguage,
        dataset_id: datasetId as string,
      }
    }
    if (dataSourceType === DataSourceType.WEB) {
      return {
        info_list: {
          data_source_type: dataSourceType,
          website_info_list: getWebsiteInfo(),
        },
        indexing_technique: getIndexing_technique() as string,
        process_rule: getProcessRule(),
        doc_form: docForm,
        doc_language: docLanguage,
        dataset_id: datasetId as string,
      }
    }
  }
  const {
    modelList: rerankModelList,
    defaultModel: rerankDefaultModel,
    currentModel: isRerankDefaultModelValid,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const { data: embeddingModelList } = useModelList(ModelTypeEnum.textEmbedding)
  const { data: defaultEmbeddingModel } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const [embeddingModel, setEmbeddingModel] = useState<DefaultModel>(
    currentDataset?.embedding_model
      ? {
        provider: currentDataset.embedding_model_provider,
        model: currentDataset.embedding_model,
      }
      : {
        provider: defaultEmbeddingModel?.provider.provider || '',
        model: defaultEmbeddingModel?.model || '',
      },
  )
  const getCreationParams = () => {
    let params
    if (segmentationType === SegmentType.CUSTOM && overlap > max) {
      Toast.notify({ type: 'error', message: t('datasetCreation.stepTwo.overlapCheck') })
      return
    }
    if (isSetting) {
      params = {
        original_document_id: documentDetail?.id,
        doc_form: docForm,
        doc_language: docLanguage,
        process_rule: getProcessRule(),
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        retrieval_model: retrievalConfig, // Readonly. If want to changed, just go to settings page.
        embedding_model: embeddingModel.model, // Readonly
        embedding_model_provider: embeddingModel.provider, // Readonly
      } as CreateDocumentReq
    }
    else { // create
      const indexMethod = getIndexing_technique()
      if (
        !isReRankModelSelected({
          rerankDefaultModel,
          isRerankDefaultModelValid: !!isRerankDefaultModelValid,
          rerankModelList,
          // eslint-disable-next-line @typescript-eslint/no-use-before-define
          retrievalConfig,
          indexMethod: indexMethod as string,
        })
      ) {
        Toast.notify({ type: 'error', message: t('appDebug.datasetConfig.rerankModelRequired') })
        return
      }
      const postRetrievalConfig = ensureRerankModelSelected({
        rerankDefaultModel: rerankDefaultModel!,
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        retrievalConfig,
        indexMethod: indexMethod as string,
      })
      params = {
        data_source: {
          type: dataSourceType,
          info_list: {
            data_source_type: dataSourceType,
          },
        },
        indexing_technique: getIndexing_technique(),
        process_rule: getProcessRule(),
        doc_form: docForm,
        doc_language: docLanguage,

        retrieval_model: postRetrievalConfig,
        embedding_model: embeddingModel.model,
        embedding_model_provider: embeddingModel.provider,
      } as CreateDocumentReq
      if (dataSourceType === DataSourceType.FILE) {
        params.data_source.info_list.file_info_list = {
          file_ids: files.map(file => file.id || '').filter(Boolean),
        }
      }
      if (dataSourceType === DataSourceType.NOTION)
        params.data_source.info_list.notion_info_list = getNotionInfo()

      if (dataSourceType === DataSourceType.WEB)
        params.data_source.info_list.website_info_list = getWebsiteInfo()
    }
    return params
  }

  const getRules = async () => {
    try {
      const res = await fetchDefaultProcessRule({ url: '/datasets/process-rule' })
      const separator = res.rules.segmentation.separator
      setSegmentIdentifier(separator)
      setMax(res.rules.segmentation.max_tokens)
      setOverlap(res.rules.segmentation.chunk_overlap)
      setRules(res.rules.pre_processing_rules)
      setDefaultConfig(res.rules)
    }
    catch (err) {
      console.log(err)
    }
  }

  const getRulesFromDetail = () => {
    if (documentDetail) {
      const rules = documentDetail.dataset_process_rule.rules
      const separator = rules.segmentation.separator
      const max = rules.segmentation.max_tokens
      const overlap = rules.segmentation.chunk_overlap
      setSegmentIdentifier(separator)
      setMax(max)
      setOverlap(overlap)
      setRules(rules.pre_processing_rules)
      setDefaultConfig(rules)
    }
  }

  const getDefaultMode = () => {
    if (documentDetail)
      setSegmentationType(documentDetail.dataset_process_rule.mode)
  }

  const createHandle = async () => {
    if (isCreating)
      return
    setIsCreating(true)
    try {
      let res
      const params = getCreationParams()
      if (!params)
        return false

      setIsCreating(true)
      if (!datasetId) {
        res = await createFirstDocument({
          body: params as CreateDocumentReq,
        })
        updateIndexingTypeCache && updateIndexingTypeCache(indexType as string)
        updateResultCache && updateResultCache(res)
      }
      else {
        res = await createDocument({
          datasetId,
          body: params as CreateDocumentReq,
        })
        updateIndexingTypeCache && updateIndexingTypeCache(indexType as string)
        updateResultCache && updateResultCache(res)
      }
      if (mutateDatasetRes)
        mutateDatasetRes()
      onStepChange && onStepChange(+1)
      isSetting && onSave && onSave()
    }
    catch (err) {
      Toast.notify({
        type: 'error',
        message: `${err}`,
      })
    }
    finally {
      setIsCreating(false)
    }
  }

  const handleSwitch = (state: boolean) => {
    if (state)
      setDocForm(DocForm.QA)
    else
      setDocForm(DocForm.TEXT)
  }

  const handleSelect = (language: string) => {
    setDocLanguage(language)
  }

  const changeToEconomicalType = () => {
    if (!hasSetIndexType) {
      setIndexType(IndexingType.ECONOMICAL)
      setDocForm(DocForm.TEXT)
    }
  }

  const previewSwitch = async () => {
    setPreviewSwitched(true)
    if (segmentationType === SegmentType.AUTO)
      setAutomaticFileIndexingEstimate(null)
    else
      setCustomFileIndexingEstimate(null)
    await fetchFileIndexingEstimate(DocForm.QA)
  }

  useEffect(() => {
    // fetch rules
    if (!isSetting) {
      getRules()
    }
    else {
      getRulesFromDetail()
      getDefaultMode()
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.addEventListener('scroll', scrollHandle)
    return () => {
      scrollRef.current?.removeEventListener('scroll', scrollHandle)
    }
  }, [])

  useLayoutEffect(() => {
    if (showPreview) {
      previewScrollRef.current?.addEventListener('scroll', previewScrollHandle)
      return () => {
        previewScrollRef.current?.removeEventListener('scroll', previewScrollHandle)
      }
    }
  }, [showPreview])

  useEffect(() => {
    if (indexingType === IndexingType.ECONOMICAL && docForm === DocForm.QA)
      setDocForm(DocForm.TEXT)
  }, [indexingType, docForm])

  useEffect(() => {
    // get indexing type by props
    if (indexingType)
      setIndexType(indexingType as IndexingType)

    else
      setIndexType(isAPIKeySet ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL)
  }, [isAPIKeySet, indexingType, datasetId])

  useEffect(() => {
    if (segmentationType === SegmentType.AUTO) {
      setAutomaticFileIndexingEstimate(null)
      !isMobile && setShowPreview()
      fetchFileIndexingEstimate()
      setPreviewSwitched(false)
    }
    else {
      hidePreview()
      setCustomFileIndexingEstimate(null)
      setPreviewSwitched(false)
    }
  }, [segmentationType, indexType])

  const [retrievalConfig, setRetrievalConfig] = useState(currentDataset?.retrieval_model_dict || {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: rerankDefaultModel?.provider.provider,
      reranking_model_name: rerankDefaultModel?.model,
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  } as RetrievalConfig)

  return (
    <div className='flex w-full h-full'>
      <div ref={scrollRef} className='relative h-full w-full overflow-y-scroll'>
        <div className={cn(s.pageHeader, scrolled && s.fixed, isMobile && '!px-6')}>
          <span>{t('datasetCreation.steps.two')}</span>
          {isMobile && (
            <Button
              className='border-[0.5px] !h-8 hover:outline hover:outline-[0.5px] hover:outline-gray-300 text-gray-700 font-medium bg-white shadow-[0px_1px_2px_0px_rgba(16,24,40,0.05)]'
              onClick={setShowPreview}
            >
              <Tooltip>
                <div className="flex flex-row items-center">
                  <RocketLaunchIcon className="h-4 w-4 mr-1.5 stroke-[1.8px]" />
                  <span className="text-[13px]">{t('datasetCreation.stepTwo.previewTitleButton')}</span>
                </div>
              </Tooltip>
            </Button>
          )}
        </div>
        <div className={cn(s.form, isMobile && '!px-4')}>
          <div className={s.label}>{t('datasetCreation.stepTwo.segmentation')}</div>
          <div className='max-w-[640px]'>
            <div
              className={cn(
                s.radioItem,
                s.segmentationItem,
                segmentationType === SegmentType.AUTO && s.active,
              )}
              onClick={() => setSegmentationType(SegmentType.AUTO)}
            >
              <span className={cn(s.typeIcon, s.auto)} />
              <span className={cn(s.radio)} />
              <div className={s.typeHeader}>
                <div className={s.title}>{t('datasetCreation.stepTwo.auto')}</div>
                <div className={s.tip}>{t('datasetCreation.stepTwo.autoDescription')}</div>
              </div>
            </div>
            <div
              className={cn(
                s.radioItem,
                s.segmentationItem,
                segmentationType === SegmentType.CUSTOM && s.active,
                segmentationType === SegmentType.CUSTOM && s.custom,
              )}
              onClick={() => setSegmentationType(SegmentType.CUSTOM)}
            >
              <span className={cn(s.typeIcon, s.customize)} />
              <span className={cn(s.radio)} />
              <div className={s.typeHeader}>
                <div className={s.title}>{t('datasetCreation.stepTwo.custom')}</div>
                <div className={s.tip}>{t('datasetCreation.stepTwo.customDescription')}</div>
              </div>
              {segmentationType === SegmentType.CUSTOM && (
                <div className={s.typeFormBody}>
                  <div className={s.formRow}>
                    <div className='w-full'>
                      <div className={s.label}>
                        {t('datasetCreation.stepTwo.separator')}
                        <Tooltip
                          popupContent={
                            <div className='max-w-[200px]'>
                              {t('datasetCreation.stepTwo.separatorTip')}
                            </div>
                          }
                        />
                      </div>
                      <input
                        type="text"
                        className={s.input}
                        placeholder={t('datasetCreation.stepTwo.separatorPlaceholder') || ''}
                        value={segmentIdentifier}
                        onChange={e => doSetSegmentIdentifier(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className={s.formRow}>
                    <div className='w-full'>
                      <div className={s.label}>{t('datasetCreation.stepTwo.maxLength')}</div>
                      <div className='relative w-full'>
                        <input
                          type="number"
                          className={s.input}
                          placeholder={t('datasetCreation.stepTwo.maxLength') || ''}
                          value={max}
                          min={1}
                          onChange={e => setMax(parseInt(e.target.value.replace(/^0+/, ''), 10))}
                        />
                        <div className='absolute top-2.5 right-2.5 text-text-tertiary system-sm-regular'>Tokens</div>
                      </div>
                    </div>
                  </div>
                  <div className={s.formRow}>
                    <div className='w-full'>
                      <div className={s.label}>
                        {t('datasetCreation.stepTwo.overlap')}
                        <Tooltip
                          popupContent={
                            <div className='max-w-[200px]'>
                              {t('datasetCreation.stepTwo.overlapTip')}
                            </div>
                          }
                        />
                      </div>
                      <div className='relative w-full'>
                        <input
                          type="number"
                          className={s.input}
                          placeholder={t('datasetCreation.stepTwo.overlap') || ''}
                          value={overlap}
                          min={1}
                          onChange={e => setOverlap(parseInt(e.target.value.replace(/^0+/, ''), 10))}
                        />
                        <div className='absolute top-2.5 right-2.5 text-text-tertiary system-sm-regular'>Tokens</div>
                      </div>
                    </div>
                  </div>
                  <div className={s.formRow}>
                    <div className='w-full flex flex-col gap-1'>
                      <div className={s.label}>{t('datasetCreation.stepTwo.rules')}</div>
                      {rules.map(rule => (
                        <div key={rule.id} className={s.ruleItem}>
                          <input id={rule.id} type="checkbox" checked={rule.enabled} onChange={() => ruleChangeHandle(rule.id)} className="w-4 h-4 rounded border-gray-300 text-blue-700 focus:ring-blue-700" />
                          <label htmlFor={rule.id} className="ml-2 text-sm font-normal cursor-pointer text-gray-800">{getRuleName(rule.id)}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={s.formFooter}>
                    <Button variant="primary" className={cn(s.button)} onClick={confirmChangeCustomConfig}>{t('datasetCreation.stepTwo.preview')}</Button>
                    <Button className={cn(s.button, 'ml-2')} onClick={resetRules}>{t('datasetCreation.stepTwo.reset')}</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={s.label}>{t('datasetCreation.stepTwo.indexMode')}</div>
          <div className='max-w-[640px]'>
            <div className='flex items-center gap-3 flex-wrap sm:flex-nowrap'>
              {(!hasSetIndexType || (hasSetIndexType && indexingType === IndexingType.QUALIFIED)) && (
                <div
                  className={cn(
                    s.radioItem,
                    s.indexItem,
                    !isAPIKeySet && s.disabled,
                    !hasSetIndexType && indexType === IndexingType.QUALIFIED && s.active,
                    hasSetIndexType && s.disabled,
                    hasSetIndexType && '!w-full !min-h-[96px]',
                  )}
                  onClick={() => {
                    if (isAPIKeySet)
                      setIndexType(IndexingType.QUALIFIED)
                  }}
                >
                  <span className={cn(s.typeIcon, s.qualified)} />
                  {!hasSetIndexType && <span className={cn(s.radio)} />}
                  <div className={s.typeHeader}>
                    <div className={s.title}>
                      {t('datasetCreation.stepTwo.qualified')}
                      {!hasSetIndexType && <span className={s.recommendTag}>{t('datasetCreation.stepTwo.recommend')}</span>}
                    </div>
                    <div className={s.tip}>{t('datasetCreation.stepTwo.qualifiedTip')}</div>
                  </div>
                  {!isAPIKeySet && (
                    <div className={s.warningTip}>
                      <span>{t('datasetCreation.stepTwo.warning')}&nbsp;</span>
                      <span className={s.click} onClick={onSetting}>{t('datasetCreation.stepTwo.click')}</span>
                    </div>
                  )}
                </div>
              )}

              {(!hasSetIndexType || (hasSetIndexType && indexingType === IndexingType.ECONOMICAL)) && (
                <div
                  className={cn(
                    s.radioItem,
                    s.indexItem,
                    !hasSetIndexType && indexType === IndexingType.ECONOMICAL && s.active,
                    hasSetIndexType && s.disabled,
                    hasSetIndexType && '!w-full !min-h-[96px]',
                  )}
                  onClick={changeToEconomicalType}
                >
                  <span className={cn(s.typeIcon, s.economical)} />
                  {!hasSetIndexType && <span className={cn(s.radio)} />}
                  <div className={s.typeHeader}>
                    <div className={s.title}>{t('datasetCreation.stepTwo.economical')}</div>
                    <div className={s.tip}>{t('datasetCreation.stepTwo.economicalTip')}</div>
                  </div>
                </div>
              )}
            </div>
            {hasSetIndexType && indexType === IndexingType.ECONOMICAL && (
              <div className='mt-2 text-xs text-gray-500 font-medium'>
                {t('datasetCreation.stepTwo.indexSettingTip')}
                <Link className='text-[#155EEF]' href={`/datasets/${datasetId}/settings`}>{t('datasetCreation.stepTwo.datasetSettingLink')}</Link>
              </div>
            )}
            {IS_CE_EDITION && indexType === IndexingType.QUALIFIED && (
              <div className='mt-3 rounded-xl bg-gray-50 border border-gray-100'>
                <div className='flex justify-between items-center px-5 py-4'>
                  <div className='flex justify-center items-center w-8 h-8 rounded-lg bg-indigo-50'>
                    <MessageChatSquare className='w-4 h-4' />
                  </div>
                  <div className='grow mx-3'>
                    <div className='mb-[2px] text-md font-medium text-gray-900'>{t('datasetCreation.stepTwo.QATitle')}</div>
                    <div className='inline-flex items-center text-[13px] leading-[18px] text-gray-500'>
                      <span className='pr-1'>{t('datasetCreation.stepTwo.QALanguage')}</span>
                      <LanguageSelect currentLanguage={docLanguage} onSelect={handleSelect} />
                    </div>
                  </div>
                  <div className='shrink-0'>
                    <Switch
                      defaultValue={docForm === DocForm.QA}
                      onChange={handleSwitch}
                      size='md'
                    />
                  </div>
                </div>
                {docForm === DocForm.QA && !QATipHide && (
                  <div className='flex justify-between items-center px-5 py-2 bg-orange-50 border-t border-amber-100 rounded-b-xl text-[13px] leading-[18px] text-medium text-amber-500'>
                    {t('datasetCreation.stepTwo.QATip')}
                    <RiCloseLine className='w-4 h-4 text-gray-500 cursor-pointer' onClick={() => setQATipHide(true)} />
                  </div>
                )}
              </div>
            )}
            {/* Embedding model */}
            {indexType === IndexingType.QUALIFIED && (
              <div className='mb-2'>
                <div className={cn(s.label, datasetId && 'flex justify-between items-center')}>{t('datasetSettings.form.embeddingModel')}</div>
                <ModelSelector
                  readonly={!!datasetId}
                  defaultModel={embeddingModel}
                  modelList={embeddingModelList}
                  onSelect={(model: DefaultModel) => {
                    setEmbeddingModel(model)
                  }}
                />
                {!!datasetId && (
                  <div className='mt-2 text-xs text-gray-500 font-medium'>
                    {t('datasetCreation.stepTwo.indexSettingTip')}
                    <Link className='text-[#155EEF]' href={`/datasets/${datasetId}/settings`}>{t('datasetCreation.stepTwo.datasetSettingLink')}</Link>
                  </div>
                )}
              </div>
            )}
            {/* Retrieval Method Config */}
            <div>
              {!datasetId
                ? (
                  <div className={s.label}>
                    <div className='shrink-0 mr-4'>{t('datasetSettings.form.retrievalSetting.title')}</div>
                    <div className='leading-[18px] text-xs font-normal text-gray-500'>
                      <a target='_blank' rel='noopener noreferrer' href='https://docs.dify.ai/guides/knowledge-base/create-knowledge-and-upload-documents#id-4-retrieval-settings' className='text-[#155eef]'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
                      {t('datasetSettings.form.retrievalSetting.longDescription')}
                    </div>
                  </div>
                )
                : (
                  <div className={cn(s.label, 'flex justify-between items-center')}>
                    <div>{t('datasetSettings.form.retrievalSetting.title')}</div>
                  </div>
                )}

              <div className='max-w-[640px]'>
                {
                  getIndexing_technique() === IndexingType.QUALIFIED
                    ? (
                      <RetrievalMethodConfig
                        value={retrievalConfig}
                        onChange={setRetrievalConfig}
                      />
                    )
                    : (
                      <EconomicalRetrievalMethodConfig
                        value={retrievalConfig}
                        onChange={setRetrievalConfig}
                      />
                    )
                }
              </div>
            </div>

            <div className={s.source}>
              <div className={s.sourceContent}>
                {dataSourceType === DataSourceType.FILE && (
                  <>
                    <div className='mb-2 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.fileSource')}</div>
                    <div className='flex items-center text-sm leading-6 font-medium text-gray-800'>
                      <span className={cn(s.fileIcon, files.length && s[files[0].extension || ''])} />
                      {getFileName(files[0].name || '')}
                      {files.length > 1 && (
                        <span className={s.sourceCount}>
                          <span>{t('datasetCreation.stepTwo.other')}</span>
                          <span>{files.length - 1}</span>
                          <span>{t('datasetCreation.stepTwo.fileUnit')}</span>
                        </span>
                      )}
                    </div>
                  </>
                )}
                {dataSourceType === DataSourceType.NOTION && (
                  <>
                    <div className='mb-2 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.notionSource')}</div>
                    <div className='flex items-center text-sm leading-6 font-medium text-gray-800'>
                      <NotionIcon
                        className='shrink-0 mr-1'
                        type='page'
                        src={notionPages[0]?.page_icon}
                      />
                      {notionPages[0]?.page_name}
                      {notionPages.length > 1 && (
                        <span className={s.sourceCount}>
                          <span>{t('datasetCreation.stepTwo.other')}</span>
                          <span>{notionPages.length - 1}</span>
                          <span>{t('datasetCreation.stepTwo.notionUnit')}</span>
                        </span>
                      )}
                    </div>
                  </>
                )}
                {dataSourceType === DataSourceType.WEB && (
                  <>
                    <div className='mb-2 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.websiteSource')}</div>
                    <div className='flex items-center text-sm leading-6 font-medium text-gray-800'>
                      <Globe01 className='shrink-0 mr-1' />
                      <span className='grow w-0 truncate'>{websitePages[0].source_url}</span>
                      {websitePages.length > 1 && (
                        <span className={s.sourceCount}>
                          <span>{t('datasetCreation.stepTwo.other')}</span>
                          <span>{websitePages.length - 1}</span>
                          <span>{t('datasetCreation.stepTwo.webpageUnit')}</span>
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className={s.divider} />
              <div className={s.segmentCount}>
                <div className='mb-2 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.estimateSegment')}</div>
                <div className='flex items-center text-sm leading-6 font-medium text-gray-800'>
                  {
                    fileIndexingEstimate
                      ? (
                        <div className='text-xs font-medium text-gray-800'>{formatNumber(fileIndexingEstimate.total_segments)} </div>
                      )
                      : (
                        <div className={s.calculating}>{t('datasetCreation.stepTwo.calculating')}</div>
                      )
                  }
                </div>
              </div>
            </div>
            {!isSetting
              ? (
                <div className='flex items-center mt-8 py-2'>
                  <Button onClick={() => onStepChange && onStepChange(-1)}>{t('datasetCreation.stepTwo.previousStep')}</Button>
                  <div className={s.divider} />
                  <Button loading={isCreating} variant='primary' onClick={createHandle}>{t('datasetCreation.stepTwo.nextStep')}</Button>
                </div>
              )
              : (
                <div className='flex items-center mt-8 py-2'>
                  <Button loading={isCreating} variant='primary' onClick={createHandle}>{t('datasetCreation.stepTwo.save')}</Button>
                  <Button className='ml-2' onClick={onCancel}>{t('datasetCreation.stepTwo.cancel')}</Button>
                </div>
              )}
          </div>
        </div>
      </div>
      <FloatRightContainer isMobile={isMobile} isOpen={showPreview} onClose={hidePreview} footer={null}>
        {showPreview && <div ref={previewScrollRef} className={cn(s.previewWrap, isMobile && s.isMobile, 'relative h-full overflow-y-scroll border-l border-[#F2F4F7]')}>
          <div className={cn(s.previewHeader, previewScrolled && `${s.fixed} pb-3`)}>
            <div className='flex items-center justify-between px-8'>
              <div className='grow flex items-center'>
                <div>{t('datasetCreation.stepTwo.previewTitle')}</div>
                {docForm === DocForm.QA && !previewSwitched && (
                  <Button className='ml-2' variant='secondary-accent' onClick={previewSwitch}>{t('datasetCreation.stepTwo.previewButton')}</Button>
                )}
              </div>
              <div className='flex items-center justify-center w-6 h-6 cursor-pointer' onClick={hidePreview}>
                <XMarkIcon className='h-4 w-4'></XMarkIcon>
              </div>
            </div>
            {docForm === DocForm.QA && !previewSwitched && (
              <div className='px-8 pr-12 text-xs text-gray-500'>
                <span>{t('datasetCreation.stepTwo.previewSwitchTipStart')}</span>
                <span className='text-amber-600'>{t('datasetCreation.stepTwo.previewSwitchTipEnd')}</span>
              </div>
            )}
          </div>
          <div className='my-4 px-8 space-y-4'>
            {previewSwitched && docForm === DocForm.QA && fileIndexingEstimate?.qa_preview && (
              <>
                {fileIndexingEstimate?.qa_preview.map((item, index) => (
                  <PreviewItem type={PreviewType.QA} key={item.question} qa={item} index={index + 1} />
                ))}
              </>
            )}
            {(docForm === DocForm.TEXT || !previewSwitched) && fileIndexingEstimate?.preview && (
              <>
                {fileIndexingEstimate?.preview.map((item, index) => (
                  <PreviewItem type={PreviewType.TEXT} key={item} content={item} index={index + 1} />
                ))}
              </>
            )}
            {previewSwitched && docForm === DocForm.QA && !fileIndexingEstimate?.qa_preview && (
              <div className='flex items-center justify-center h-[200px]'>
                <Loading type='area' />
              </div>
            )}
            {!previewSwitched && !fileIndexingEstimate?.preview && (
              <div className='flex items-center justify-center h-[200px]'>
                <Loading type='area' />
              </div>
            )}
          </div>
        </div>}
        {!showPreview && (
          <div className={cn(s.sideTip)}>
            <div className={s.tipCard}>
              <span className={s.icon} />
              <div className={s.title}>{t('datasetCreation.stepTwo.sideTipTitle')}</div>
              <div className={s.content}>
                <p className='mb-3'>{t('datasetCreation.stepTwo.sideTipP1')}</p>
                <p className='mb-3'>{t('datasetCreation.stepTwo.sideTipP2')}</p>
                <p className='mb-3'>{t('datasetCreation.stepTwo.sideTipP3')}</p>
                <p>{t('datasetCreation.stepTwo.sideTipP4')}</p>
              </div>
            </div>
          </div>
        )}
      </FloatRightContainer>
    </div>
  )
}

export default StepTwo
