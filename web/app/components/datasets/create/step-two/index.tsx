'use client'
import type { FC, PropsWithChildren } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiAlertFill,
  RiArrowLeftLine,
  RiSearchEyeLine,
} from '@remixicon/react'
import Link from 'next/link'
import Image from 'next/image'
import { useHover } from 'ahooks'
import SettingCog from '../assets/setting-gear-mod.svg'
import OrangeEffect from '../assets/option-card-effect-orange.svg'
import FamilyMod from '../assets/family-mod.svg'
import Note from '../assets/note-mod.svg'
import FileList from '../assets/file-list-3-fill.svg'
import { indexMethodIcon } from '../icons'
import { PreviewContainer } from '../../preview/container'
import { ChunkContainer, QAPreview } from '../../chunk'
import { PreviewHeader } from '../../preview/header'
import { FormattedText } from '../../formatted-text/formatted'
import { PreviewSlice } from '../../formatted-text/flavours/preview-slice'
import PreviewDocumentPicker from '../../common/document-picker/preview-document-picker'
import s from './index.module.css'
import unescape from './unescape'
import escape from './escape'
import { OptionCard } from './option-card'
import LanguageSelect from './language-select'
import { DelimiterInput, MaxLengthInput, OverlapInput } from './inputs'
import cn from '@/utils/classnames'
import type { CrawlOptions, CrawlResultItem, CreateDocumentReq, CustomFile, DocumentItem, FullDocumentDetail, ParentMode, PreProcessingRule, ProcessRule, Rules, createDocumentResponse } from '@/models/datasets'
import { ChunkingMode, DataSourceType, ProcessMode } from '@/models/datasets'

import Button from '@/app/components/base/button'
import FloatRightContainer from '@/app/components/base/float-right-container'
import RetrievalMethodConfig from '@/app/components/datasets/common/retrieval-method-config'
import EconomicalRetrievalMethodConfig from '@/app/components/datasets/common/economical-retrieval-method-config'
import type { RetrievalConfig } from '@/types/app'
import { isReRankModelSelected } from '@/app/components/datasets/common/check-rerank-model'
import Toast from '@/app/components/base/toast'
import type { NotionPage } from '@/models/common'
import { DataSourceProvider } from '@/models/common'
import { useDatasetDetailContext } from '@/context/dataset-detail'
import I18n from '@/context/i18n'
import { RETRIEVE_METHOD } from '@/types/app'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useDefaultModel, useModelList, useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { LanguagesSupported } from '@/i18n/language'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Checkbox from '@/app/components/base/checkbox'
import RadioCard from '@/app/components/base/radio-card'
import { FULL_DOC_PREVIEW_LENGTH, IS_CE_EDITION } from '@/config'
import Divider from '@/app/components/base/divider'
import { getNotionInfo, getWebsiteInfo, useCreateDocument, useCreateFirstDocument, useFetchDefaultProcessRule, useFetchFileIndexingEstimateForFile, useFetchFileIndexingEstimateForNotion, useFetchFileIndexingEstimateForWeb } from '@/service/knowledge/use-create-dataset'
import Badge from '@/app/components/base/badge'
import { SkeletonContainer, SkeletonPoint, SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import Tooltip from '@/app/components/base/tooltip'
import CustomDialog from '@/app/components/base/dialog'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { noop } from 'lodash-es'
import { useDocLink } from '@/context/i18n'

const TextLabel: FC<PropsWithChildren> = (props) => {
  return <label className='system-sm-semibold text-text-secondary'>{props.children}</label>
}

type StepTwoProps = {
  isSetting?: boolean
  documentDetail?: FullDocumentDetail
  isAPIKeySet: boolean
  onSetting: () => void
  datasetId?: string
  indexingType?: IndexingType
  retrievalMethod?: string
  dataSourceType: DataSourceType
  files: CustomFile[]
  notionPages?: NotionPage[]
  websitePages?: CrawlResultItem[]
  crawlOptions?: CrawlOptions
  websiteCrawlProvider?: DataSourceProvider
  websiteCrawlJobId?: string
  onStepChange?: (delta: number) => void
  updateIndexingTypeCache?: (type: string) => void
  updateRetrievalMethodCache?: (method: string) => void
  updateResultCache?: (res: createDocumentResponse) => void
  onSave?: () => void
  onCancel?: () => void
}

export enum IndexingType {
  QUALIFIED = 'high_quality',
  ECONOMICAL = 'economy',
}

const DEFAULT_SEGMENT_IDENTIFIER = '\\n\\n'
const DEFAULT_MAXIMUM_CHUNK_LENGTH = 1024
const DEFAULT_OVERLAP = 50
const MAXIMUM_CHUNK_TOKEN_LENGTH = Number.parseInt(globalThis.document?.body?.getAttribute('data-public-indexing-max-segmentation-tokens-length') || '4000', 10)

type ParentChildConfig = {
  chunkForContext: ParentMode
  parent: {
    delimiter: string
    maxLength: number
  }
  child: {
    delimiter: string
    maxLength: number
  }
}

const defaultParentChildConfig: ParentChildConfig = {
  chunkForContext: 'paragraph',
  parent: {
    delimiter: '\\n\\n',
    maxLength: 1024,
  },
  child: {
    delimiter: '\\n',
    maxLength: 512,
  },
}

const StepTwo = ({
  isSetting,
  documentDetail,
  isAPIKeySet,
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
  updateRetrievalMethodCache,
}: StepTwoProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { locale } = useContext(I18n)
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { dataset: currentDataset, mutateDatasetRes } = useDatasetDetailContext()

  const isInUpload = Boolean(currentDataset)
  const isUploadInEmptyDataset = isInUpload && !currentDataset?.doc_form
  const isNotUploadInEmptyDataset = !isUploadInEmptyDataset
  const isInInit = !isInUpload && !isSetting

  const isInCreatePage = !datasetId || (datasetId && !currentDataset?.data_source_type)
  const dataSourceType = isInCreatePage ? inCreatePageDataSourceType : currentDataset?.data_source_type
  const [segmentationType, setSegmentationType] = useState<ProcessMode>(
    currentDataset?.doc_form === ChunkingMode.parentChild ? ProcessMode.parentChild : ProcessMode.general,
  )
  const [segmentIdentifier, doSetSegmentIdentifier] = useState(DEFAULT_SEGMENT_IDENTIFIER)
  const setSegmentIdentifier = useCallback((value: string, canEmpty?: boolean) => {
    doSetSegmentIdentifier(value ? escape(value) : (canEmpty ? '' : DEFAULT_SEGMENT_IDENTIFIER))
  }, [])
  const [maxChunkLength, setMaxChunkLength] = useState(DEFAULT_MAXIMUM_CHUNK_LENGTH) // default chunk length
  const [limitMaxChunkLength, setLimitMaxChunkLength] = useState(MAXIMUM_CHUNK_TOKEN_LENGTH)
  const [overlap, setOverlap] = useState(DEFAULT_OVERLAP)
  const [rules, setRules] = useState<PreProcessingRule[]>([])
  const [defaultConfig, setDefaultConfig] = useState<Rules>()
  const hasSetIndexType = !!indexingType
  const [indexType, setIndexType] = useState<IndexingType>(() => {
    if (hasSetIndexType)
      return indexingType
    return isAPIKeySet ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL
  })

  const [previewFile, setPreviewFile] = useState<DocumentItem>(
    (datasetId && documentDetail)
      ? documentDetail.file
      : files[0],
  )
  const [previewNotionPage, setPreviewNotionPage] = useState<NotionPage>(
    (datasetId && documentDetail)
      ? documentDetail.notion_page
      : notionPages[0],
  )

  const [previewWebsitePage, setPreviewWebsitePage] = useState<CrawlResultItem>(
    (datasetId && documentDetail)
      ? documentDetail.website_page
      : websitePages[0],
  )

  // QA Related
  const [isQAConfirmDialogOpen, setIsQAConfirmDialogOpen] = useState(false)
  const [docForm, setDocForm] = useState<ChunkingMode>(
    (datasetId && documentDetail) ? documentDetail.doc_form as ChunkingMode : ChunkingMode.text,
  )
  const handleChangeDocform = (value: ChunkingMode) => {
    if (value === ChunkingMode.qa && indexType === IndexingType.ECONOMICAL) {
      setIsQAConfirmDialogOpen(true)
      return
    }
    if (value === ChunkingMode.parentChild && indexType === IndexingType.ECONOMICAL)
      setIndexType(IndexingType.QUALIFIED)

    setDocForm(value)

    if (value === ChunkingMode.parentChild)
      setSegmentationType(ProcessMode.parentChild)
    else
      setSegmentationType(ProcessMode.general)

    // eslint-disable-next-line ts/no-use-before-define
    currentEstimateMutation.reset()
  }

  const [docLanguage, setDocLanguage] = useState<string>(
    (datasetId && documentDetail) ? documentDetail.doc_language : (locale !== LanguagesSupported[1] ? 'English' : 'Chinese Simplified'),
  )

  const [parentChildConfig, setParentChildConfig] = useState<ParentChildConfig>(defaultParentChildConfig)

  const getIndexing_technique = () => indexingType || indexType
  const currentDocForm = currentDataset?.doc_form || docForm

  const getProcessRule = (): ProcessRule => {
    if (currentDocForm === ChunkingMode.parentChild) {
      return {
        rules: {
          pre_processing_rules: rules,
          segmentation: {
            separator: unescape(
              parentChildConfig.parent.delimiter,
            ),
            max_tokens: parentChildConfig.parent.maxLength,
          },
          parent_mode: parentChildConfig.chunkForContext,
          subchunk_segmentation: {
            separator: unescape(parentChildConfig.child.delimiter),
            max_tokens: parentChildConfig.child.maxLength,
          },
        },
        mode: 'hierarchical',
      } as ProcessRule
    }
    return {
      rules: {
        pre_processing_rules: rules,
        segmentation: {
          separator: unescape(segmentIdentifier),
          max_tokens: maxChunkLength,
          chunk_overlap: overlap,
        },
      }, // api will check this. It will be removed after api refactored.
      mode: segmentationType,
    } as ProcessRule
  }

  const fileIndexingEstimateQuery = useFetchFileIndexingEstimateForFile({
    docForm: currentDocForm,
    docLanguage,
    dataSourceType: DataSourceType.FILE,
    files: previewFile
      ? [files.find(file => file.name === previewFile.name)!]
      : files,
    indexingTechnique: getIndexing_technique() as any,
    processRule: getProcessRule(),
    dataset_id: datasetId!,
  })
  const notionIndexingEstimateQuery = useFetchFileIndexingEstimateForNotion({
    docForm: currentDocForm,
    docLanguage,
    dataSourceType: DataSourceType.NOTION,
    notionPages: [previewNotionPage],
    indexingTechnique: getIndexing_technique() as any,
    processRule: getProcessRule(),
    dataset_id: datasetId || '',
  })

  const websiteIndexingEstimateQuery = useFetchFileIndexingEstimateForWeb({
    docForm: currentDocForm,
    docLanguage,
    dataSourceType: DataSourceType.WEB,
    websitePages: [previewWebsitePage],
    crawlOptions,
    websiteCrawlProvider,
    websiteCrawlJobId,
    indexingTechnique: getIndexing_technique() as any,
    processRule: getProcessRule(),
    dataset_id: datasetId || '',
  })

  const currentEstimateMutation = dataSourceType === DataSourceType.FILE
    ? fileIndexingEstimateQuery
    : dataSourceType === DataSourceType.NOTION
      ? notionIndexingEstimateQuery
      : websiteIndexingEstimateQuery

  const fetchEstimate = useCallback(() => {
    if (dataSourceType === DataSourceType.FILE)
      fileIndexingEstimateQuery.mutate()

    if (dataSourceType === DataSourceType.NOTION)
      notionIndexingEstimateQuery.mutate()

    if (dataSourceType === DataSourceType.WEB)
      websiteIndexingEstimateQuery.mutate()
  }, [dataSourceType, fileIndexingEstimateQuery, notionIndexingEstimateQuery, websiteIndexingEstimateQuery])

  const estimate
    = dataSourceType === DataSourceType.FILE
      ? fileIndexingEstimateQuery.data
      : dataSourceType === DataSourceType.NOTION
        ? notionIndexingEstimateQuery.data
        : websiteIndexingEstimateQuery.data

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
      setMaxChunkLength(defaultConfig.segmentation.max_tokens)
      setOverlap(defaultConfig.segmentation.chunk_overlap!)
      setRules(defaultConfig.pre_processing_rules)
    }
    setParentChildConfig(defaultParentChildConfig)
  }

  const updatePreview = () => {
    if (segmentationType === ProcessMode.general && maxChunkLength > MAXIMUM_CHUNK_TOKEN_LENGTH) {
      Toast.notify({ type: 'error', message: t('datasetCreation.stepTwo.maxLengthCheck', { limit: MAXIMUM_CHUNK_TOKEN_LENGTH }) })
      return
    }
    fetchEstimate()
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
  const [retrievalConfig, setRetrievalConfig] = useState(currentDataset?.retrieval_model_dict || {
    search_method: RETRIEVE_METHOD.semantic,
    reranking_enable: false,
    reranking_model: {
      reranking_provider_name: '',
      reranking_model_name: '',
    },
    top_k: 3,
    score_threshold_enabled: false,
    score_threshold: 0.5,
  } as RetrievalConfig)

  useEffect(() => {
    if (currentDataset?.retrieval_model_dict)
      return
    setRetrievalConfig({
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: !!isRerankDefaultModelValid,
      reranking_model: {
        reranking_provider_name: isRerankDefaultModelValid ? rerankDefaultModel?.provider.provider ?? '' : '',
        reranking_model_name: isRerankDefaultModelValid ? rerankDefaultModel?.model ?? '' : '',
      },
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerankDefaultModel, isRerankDefaultModelValid])

  const getCreationParams = () => {
    let params
    if (segmentationType === ProcessMode.general && overlap > maxChunkLength) {
      Toast.notify({ type: 'error', message: t('datasetCreation.stepTwo.overlapCheck') })
      return
    }
    if (segmentationType === ProcessMode.general && maxChunkLength > limitMaxChunkLength) {
      Toast.notify({ type: 'error', message: t('datasetCreation.stepTwo.maxLengthCheck', { limit: limitMaxChunkLength }) })
      return
    }
    if (isSetting) {
      params = {
        original_document_id: documentDetail?.id,
        doc_form: currentDocForm,
        doc_language: docLanguage,
        process_rule: getProcessRule(),
        retrieval_model: retrievalConfig, // Readonly. If want to changed, just go to settings page.
        embedding_model: embeddingModel.model, // Readonly
        embedding_model_provider: embeddingModel.provider, // Readonly
        indexing_technique: getIndexing_technique(),
      } as CreateDocumentReq
    }
    else { // create
      const indexMethod = getIndexing_technique()
      if (indexMethod === IndexingType.QUALIFIED && (!embeddingModel.model || !embeddingModel.provider)) {
        Toast.notify({
          type: 'error',
          message: t('appDebug.datasetConfig.embeddingModelRequired'),
        })
        return
      }
      if (
        !isReRankModelSelected({
          rerankModelList,
          retrievalConfig,
          indexMethod: indexMethod as string,
        })
      ) {
        Toast.notify({ type: 'error', message: t('appDebug.datasetConfig.rerankModelRequired') })
        return
      }
      params = {
        data_source: {
          type: dataSourceType,
          info_list: {
            data_source_type: dataSourceType,
          },
        },
        indexing_technique: getIndexing_technique(),
        process_rule: getProcessRule(),
        doc_form: currentDocForm,
        doc_language: docLanguage,
        retrieval_model: retrievalConfig,
        embedding_model: embeddingModel.model,
        embedding_model_provider: embeddingModel.provider,
      } as CreateDocumentReq
      if (dataSourceType === DataSourceType.FILE) {
        params.data_source.info_list.file_info_list = {
          file_ids: files.map(file => file.id || '').filter(Boolean),
        }
      }
      if (dataSourceType === DataSourceType.NOTION)
        params.data_source.info_list.notion_info_list = getNotionInfo(notionPages)

      if (dataSourceType === DataSourceType.WEB) {
        params.data_source.info_list.website_info_list = getWebsiteInfo({
          websiteCrawlProvider,
          websiteCrawlJobId,
          websitePages,
        })
      }
    }
    return params
  }

  const fetchDefaultProcessRuleMutation = useFetchDefaultProcessRule({
    onSuccess(data) {
      const separator = data.rules.segmentation.separator
      setSegmentIdentifier(separator)
      setMaxChunkLength(data.rules.segmentation.max_tokens)
      setOverlap(data.rules.segmentation.chunk_overlap!)
      setRules(data.rules.pre_processing_rules)
      setDefaultConfig(data.rules)
      setLimitMaxChunkLength(data.limits.indexing_max_segmentation_tokens_length)
    },
    onError(error) {
      Toast.notify({
        type: 'error',
        message: `${error}`,
      })
    },
  })

  const getRulesFromDetail = () => {
    if (documentDetail) {
      const rules = documentDetail.dataset_process_rule.rules
      const separator = rules.segmentation.separator
      const max = rules.segmentation.max_tokens
      const overlap = rules.segmentation.chunk_overlap
      const isHierarchicalDocument = documentDetail.doc_form === ChunkingMode.parentChild
                              || (rules.parent_mode && rules.subchunk_segmentation)
      setSegmentIdentifier(separator)
      setMaxChunkLength(max)
      setOverlap(overlap!)
      setRules(rules.pre_processing_rules)
      setDefaultConfig(rules)

      if (isHierarchicalDocument) {
        setParentChildConfig({
          chunkForContext: rules.parent_mode || 'paragraph',
          parent: {
            delimiter: escape(rules.segmentation.separator),
            maxLength: rules.segmentation.max_tokens,
          },
          child: {
            delimiter: escape(rules.subchunk_segmentation.separator),
            maxLength: rules.subchunk_segmentation.max_tokens,
          },
        })
      }
    }
  }

  const getDefaultMode = () => {
    if (documentDetail)
      setSegmentationType(documentDetail.dataset_process_rule.mode)
  }

  const createFirstDocumentMutation = useCreateFirstDocument({
    onError(error) {
      Toast.notify({
        type: 'error',
        message: `${error}`,
      })
    },
  })
  const createDocumentMutation = useCreateDocument(datasetId!, {
    onError(error) {
      Toast.notify({
        type: 'error',
        message: `${error}`,
      })
    },
  })

  const isCreating = createFirstDocumentMutation.isPending || createDocumentMutation.isPending

  const createHandle = async () => {
    const params = getCreationParams()
    if (!params)
      return false

    if (!datasetId) {
      await createFirstDocumentMutation.mutateAsync(
        params,
        {
          onSuccess(data) {
            updateIndexingTypeCache && updateIndexingTypeCache(indexType as string)
            updateResultCache && updateResultCache(data)
            updateRetrievalMethodCache && updateRetrievalMethodCache(retrievalConfig.search_method as string)
          },
        },
      )
    }
    else {
      await createDocumentMutation.mutateAsync(params, {
        onSuccess(data) {
          updateIndexingTypeCache && updateIndexingTypeCache(indexType as string)
          updateResultCache && updateResultCache(data)
          updateRetrievalMethodCache && updateRetrievalMethodCache(retrievalConfig.search_method as string)
        },
      })
    }
    if (mutateDatasetRes)
      mutateDatasetRes()
    onStepChange && onStepChange(+1)
    isSetting && onSave && onSave()
  }

  useEffect(() => {
    // fetch rules
    if (!isSetting) {
      fetchDefaultProcessRuleMutation.mutate('/datasets/process-rule')
    }
    else {
      getRulesFromDetail()
      getDefaultMode()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // get indexing type by props
    if (indexingType)
      setIndexType(indexingType as IndexingType)
    else
      setIndexType(isAPIKeySet ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL)
  }, [isAPIKeySet, indexingType, datasetId])

  const economyDomRef = useRef<HTMLDivElement>(null)
  const isHoveringEconomy = useHover(economyDomRef)

  const isModelAndRetrievalConfigDisabled = !!datasetId && !!currentDataset?.data_source_type

  return (
    <div className='flex h-full w-full'>
      <div className={cn('relative h-full w-1/2 overflow-y-auto py-6', isMobile ? 'px-4' : 'px-12')}>
        <div className={'system-md-semibold mb-1 text-text-secondary'}>{t('datasetCreation.stepTwo.segmentation')}</div>
        {((isInUpload && [ChunkingMode.text, ChunkingMode.qa].includes(currentDataset!.doc_form))
          || isUploadInEmptyDataset
          || isInInit)
          && <OptionCard
            className='mb-2 bg-background-section'
            title={t('datasetCreation.stepTwo.general')}
            icon={<Image width={20} height={20} src={SettingCog} alt={t('datasetCreation.stepTwo.general')} />}
            activeHeaderClassName='bg-dataset-option-card-blue-gradient'
            description={t('datasetCreation.stepTwo.generalTip')}
            isActive={
              [ChunkingMode.text, ChunkingMode.qa].includes(currentDocForm)
            }
            onSwitched={() =>
              handleChangeDocform(ChunkingMode.text)
            }
            actions={
              <>
                <Button variant={'secondary-accent'} onClick={() => updatePreview()}>
                  <RiSearchEyeLine className='mr-0.5 h-4 w-4' />
                  {t('datasetCreation.stepTwo.previewChunk')}
                </Button>
                <Button variant={'ghost'} onClick={resetRules}>
                  {t('datasetCreation.stepTwo.reset')}
                </Button>
              </>
            }
            noHighlight={isInUpload && isNotUploadInEmptyDataset}
          >
            <div className='flex flex-col gap-y-4'>
              <div className='flex gap-3'>
                <DelimiterInput
                  value={segmentIdentifier}
                  onChange={e => setSegmentIdentifier(e.target.value, true)}
                />
                <MaxLengthInput
                  unit='characters'
                  value={maxChunkLength}
                  onChange={setMaxChunkLength}
                />
                <OverlapInput
                  unit='characters'
                  value={overlap}
                  min={1}
                  onChange={setOverlap}
                />
              </div>
              <div className='flex w-full flex-col'>
                <div className='flex items-center gap-x-2'>
                  <div className='inline-flex shrink-0'>
                    <TextLabel>{t('datasetCreation.stepTwo.rules')}</TextLabel>
                  </div>
                  <Divider className='grow' bgStyle='gradient' />
                </div>
                <div className='mt-1'>
                  {rules.map(rule => (
                    <div key={rule.id} className={s.ruleItem} onClick={() => {
                      ruleChangeHandle(rule.id)
                    }}>
                      <Checkbox
                        checked={rule.enabled}
                      />
                      <label className="system-sm-regular ml-2 cursor-pointer text-text-secondary">{getRuleName(rule.id)}</label>
                    </div>
                  ))}
                  {IS_CE_EDITION && <>
                    <Divider type='horizontal' className='my-4 bg-divider-subtle' />
                    <div className='flex items-center py-0.5'>
                      <div className='flex items-center' onClick={() => {
                        if (currentDataset?.doc_form)
                          return
                        if (docForm === ChunkingMode.qa)
                          handleChangeDocform(ChunkingMode.text)
                        else
                          handleChangeDocform(ChunkingMode.qa)
                      }}>
                        <Checkbox
                          checked={currentDocForm === ChunkingMode.qa}
                          disabled={!!currentDataset?.doc_form}
                        />
                        <label className="system-sm-regular ml-2 cursor-pointer text-text-secondary">
                          {t('datasetCreation.stepTwo.useQALanguage')}
                        </label>
                      </div>
                      <LanguageSelect
                        currentLanguage={docLanguage || locale}
                        onSelect={setDocLanguage}
                        disabled={currentDocForm !== ChunkingMode.qa}
                      />
                      <Tooltip popupContent={t('datasetCreation.stepTwo.QATip')} />
                    </div>
                    {currentDocForm === ChunkingMode.qa && (
                      <div
                        style={{
                          background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.1) 0%, rgba(255, 255, 255, 0.00) 100%)',
                        }}
                        className='mt-2 flex h-10 items-center gap-2 rounded-xl border border-components-panel-border px-3 text-xs shadow-xs backdrop-blur-[5px]'
                      >
                        <RiAlertFill className='size-4 text-text-warning-secondary' />
                        <span className='system-xs-medium text-text-primary'>
                          {t('datasetCreation.stepTwo.QATip')}
                        </span>
                      </div>
                    )}
                  </>}
                </div>
              </div>
            </div>
          </OptionCard>}
        {
          (
            (isInUpload && currentDataset!.doc_form === ChunkingMode.parentChild)
            || isUploadInEmptyDataset
            || isInInit
          )
          && <OptionCard
            title={t('datasetCreation.stepTwo.parentChild')}
            icon={<Image width={20} height={20} src={FamilyMod} alt={t('datasetCreation.stepTwo.parentChild')} />}
            effectImg={OrangeEffect.src}
            activeHeaderClassName='bg-dataset-option-card-orange-gradient'
            description={t('datasetCreation.stepTwo.parentChildTip')}
            isActive={currentDocForm === ChunkingMode.parentChild}
            onSwitched={() => handleChangeDocform(ChunkingMode.parentChild)}
            actions={
              <>
                <Button variant={'secondary-accent'} onClick={() => updatePreview()}>
                  <RiSearchEyeLine className='mr-0.5 h-4 w-4' />
                  {t('datasetCreation.stepTwo.previewChunk')}
                </Button>
                <Button variant={'ghost'} onClick={resetRules}>
                  {t('datasetCreation.stepTwo.reset')}
                </Button>
              </>
            }
            noHighlight={isInUpload && isNotUploadInEmptyDataset}
          >
            <div className='flex flex-col gap-4'>
              <div>
                <div className='flex items-center gap-x-2'>
                  <div className='inline-flex shrink-0'>
                    <TextLabel>{t('datasetCreation.stepTwo.parentChunkForContext')}</TextLabel>
                  </div>
                  <Divider className='grow' bgStyle='gradient' />
                </div>
                <RadioCard className='mt-1'
                  icon={<Image src={Note} alt='' />}
                  title={t('datasetCreation.stepTwo.paragraph')}
                  description={t('datasetCreation.stepTwo.paragraphTip')}
                  isChosen={parentChildConfig.chunkForContext === 'paragraph'}
                  onChosen={() => setParentChildConfig(
                    {
                      ...parentChildConfig,
                      chunkForContext: 'paragraph',
                    },
                  )}
                  chosenConfig={
                    <div className='flex gap-3'>
                      <DelimiterInput
                        value={parentChildConfig.parent.delimiter}
                        tooltip={t('datasetCreation.stepTwo.parentChildDelimiterTip')!}
                        onChange={e => setParentChildConfig({
                          ...parentChildConfig,
                          parent: {
                            ...parentChildConfig.parent,
                            delimiter: e.target.value ? escape(e.target.value) : '',
                          },
                        })}
                      />
                      <MaxLengthInput
                        unit='characters'
                        value={parentChildConfig.parent.maxLength}
                        onChange={value => setParentChildConfig({
                          ...parentChildConfig,
                          parent: {
                            ...parentChildConfig.parent,
                            maxLength: value,
                          },
                        })}
                      />
                    </div>
                  }
                />
                <RadioCard className='mt-2'
                  icon={<Image src={FileList} alt='' />}
                  title={t('datasetCreation.stepTwo.fullDoc')}
                  description={t('datasetCreation.stepTwo.fullDocTip')}
                  onChosen={() => setParentChildConfig(
                    {
                      ...parentChildConfig,
                      chunkForContext: 'full-doc',
                    },
                  )}
                  isChosen={parentChildConfig.chunkForContext === 'full-doc'}
                />
              </div>

              <div>
                <div className='flex items-center gap-x-2'>
                  <div className='inline-flex shrink-0'>
                    <TextLabel>{t('datasetCreation.stepTwo.childChunkForRetrieval')}</TextLabel>
                  </div>
                  <Divider className='grow' bgStyle='gradient' />
                </div>
                <div className='mt-1 flex gap-3'>
                  <DelimiterInput
                    value={parentChildConfig.child.delimiter}
                    tooltip={t('datasetCreation.stepTwo.parentChildChunkDelimiterTip')!}
                    onChange={e => setParentChildConfig({
                      ...parentChildConfig,
                      child: {
                        ...parentChildConfig.child,
                        delimiter: e.target.value ? escape(e.target.value) : '',
                      },
                    })}
                  />
                  <MaxLengthInput
                    unit='characters'
                    value={parentChildConfig.child.maxLength}
                    onChange={value => setParentChildConfig({
                      ...parentChildConfig,
                      child: {
                        ...parentChildConfig.child,
                        maxLength: value,
                      },
                    })}
                  />
                </div>
              </div>
              <div>
                <div className='flex items-center gap-x-2'>
                  <div className='inline-flex shrink-0'>
                    <TextLabel>{t('datasetCreation.stepTwo.rules')}</TextLabel>
                  </div>
                  <Divider className='grow' bgStyle='gradient' />
                </div>
                <div className='mt-1'>
                  {rules.map(rule => (
                    <div key={rule.id} className={s.ruleItem} onClick={() => {
                      ruleChangeHandle(rule.id)
                    }}>
                      <Checkbox
                        checked={rule.enabled}
                      />
                      <label className="system-sm-regular ml-2 cursor-pointer text-text-secondary">{getRuleName(rule.id)}</label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </OptionCard>}
        <Divider className='my-5' />
        <div className={'system-md-semibold mb-1 text-text-secondary'}>{t('datasetCreation.stepTwo.indexMode')}</div>
        <div className='flex items-center gap-2'>
          {(!hasSetIndexType || (hasSetIndexType && indexingType === IndexingType.QUALIFIED)) && (
            <OptionCard className='flex-1 self-stretch'
              title={<div className='flex items-center'>
                {t('datasetCreation.stepTwo.qualified')}
                <Badge className={cn('ml-1 h-[18px]', (!hasSetIndexType && indexType === IndexingType.QUALIFIED) ? 'border-text-accent-secondary text-text-accent-secondary' : '')} uppercase>
                  {t('datasetCreation.stepTwo.recommend')}
                </Badge>
                <span className='ml-auto'>
                  {!hasSetIndexType && <span className={cn(s.radio)} />}
                </span>
              </div>}
              description={t('datasetCreation.stepTwo.qualifiedTip')}
              icon={<Image src={indexMethodIcon.high_quality} alt='' />}
              isActive={!hasSetIndexType && indexType === IndexingType.QUALIFIED}
              disabled={hasSetIndexType}
              onSwitched={() => {
                setIndexType(IndexingType.QUALIFIED)
              }}
            />
          )}

          {(!hasSetIndexType || (hasSetIndexType && indexingType === IndexingType.ECONOMICAL)) && (
            <>
              <CustomDialog show={isQAConfirmDialogOpen} onClose={() => setIsQAConfirmDialogOpen(false)} className='w-[432px]'>
                <header className='mb-4 pt-6'>
                  <h2 className='text-lg font-semibold text-text-primary'>
                    {t('datasetCreation.stepTwo.qaSwitchHighQualityTipTitle')}
                  </h2>
                  <p className='mt-2 text-sm font-normal text-text-secondary'>
                    {t('datasetCreation.stepTwo.qaSwitchHighQualityTipContent')}
                  </p>
                </header>
                <div className='flex gap-2 pb-6'>
                  <Button className='ml-auto' onClick={() => {
                    setIsQAConfirmDialogOpen(false)
                  }}>
                    {t('datasetCreation.stepTwo.cancel')}
                  </Button>
                  <Button variant={'primary'} onClick={() => {
                    setIsQAConfirmDialogOpen(false)
                    setIndexType(IndexingType.QUALIFIED)
                    setDocForm(ChunkingMode.qa)
                  }}>
                    {t('datasetCreation.stepTwo.switch')}
                  </Button>
                </div>
              </CustomDialog>
              <PortalToFollowElem
                open={
                  isHoveringEconomy && docForm !== ChunkingMode.text
                }
                placement={'top'}
              >
                <PortalToFollowElemTrigger asChild>
                  <OptionCard className='flex-1 self-stretch'
                    title={t('datasetCreation.stepTwo.economical')}
                    description={t('datasetCreation.stepTwo.economicalTip')}
                    icon={<Image src={indexMethodIcon.economical} alt='' />}
                    isActive={!hasSetIndexType && indexType === IndexingType.ECONOMICAL}
                    disabled={hasSetIndexType || docForm !== ChunkingMode.text}
                    ref={economyDomRef}
                    onSwitched={() => {
                      setIndexType(IndexingType.ECONOMICAL)
                    }}
                  />
                </PortalToFollowElemTrigger>
                <PortalToFollowElemContent>
                  <div className='rounded-lg border-components-panel-border bg-components-tooltip-bg p-3 text-xs font-medium text-text-secondary shadow-lg'>
                    {
                      docForm === ChunkingMode.qa
                        ? t('datasetCreation.stepTwo.notAvailableForQA')
                        : t('datasetCreation.stepTwo.notAvailableForParentChild')
                    }
                  </div>
                </PortalToFollowElemContent>
              </PortalToFollowElem>
            </>)}
        </div>
        {!hasSetIndexType && indexType === IndexingType.QUALIFIED && (
          <div className='mt-2 flex h-10 items-center gap-x-0.5 overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-2 shadow-xs backdrop-blur-[5px]'>
            <div className='absolute bottom-0 left-0 right-0 top-0 bg-dataset-warning-message-bg opacity-40'></div>
            <div className='p-1'>
              <AlertTriangle className='size-4 text-text-warning-secondary' />
            </div>
            <span className='system-xs-medium text-text-primary'>{t('datasetCreation.stepTwo.highQualityTip')}</span>
          </div>
        )}
        {hasSetIndexType && indexType === IndexingType.ECONOMICAL && (
          <div className='system-xs-medium mt-2 text-text-tertiary'>
            {t('datasetCreation.stepTwo.indexSettingTip')}
            <Link className='text-text-accent' href={`/datasets/${datasetId}/settings`}>{t('datasetCreation.stepTwo.datasetSettingLink')}</Link>
          </div>
        )}
        {/* Embedding model */}
        {indexType === IndexingType.QUALIFIED && (
          <div className='mt-5'>
            <div className={cn('system-md-semibold mb-1 text-text-secondary', datasetId && 'flex items-center justify-between')}>{t('datasetSettings.form.embeddingModel')}</div>
            <ModelSelector
              readonly={isModelAndRetrievalConfigDisabled}
              triggerClassName={isModelAndRetrievalConfigDisabled ? 'opacity-50' : ''}
              defaultModel={embeddingModel}
              modelList={embeddingModelList}
              onSelect={(model: DefaultModel) => {
                setEmbeddingModel(model)
              }}
            />
            {isModelAndRetrievalConfigDisabled && (
              <div className='system-xs-medium mt-2 text-text-tertiary'>
                {t('datasetCreation.stepTwo.indexSettingTip')}
                <Link className='text-text-accent' href={`/datasets/${datasetId}/settings`}>{t('datasetCreation.stepTwo.datasetSettingLink')}</Link>
              </div>
            )}
          </div>
        )}
        <Divider className='my-5' />
        {/* Retrieval Method Config */}
        <div>
          {!isModelAndRetrievalConfigDisabled
            ? (
              <div className={'mb-1'}>
                <div className='system-md-semibold mb-0.5 text-text-secondary'>{t('datasetSettings.form.retrievalSetting.title')}</div>
                <div className='body-xs-regular text-text-tertiary'>
                  <a target='_blank' rel='noopener noreferrer'
                    href={docLink('/guides/knowledge-base/create-knowledge-and-upload-documents')}
                    className='text-text-accent'>{t('datasetSettings.form.retrievalSetting.learnMore')}</a>
                  {t('datasetSettings.form.retrievalSetting.longDescription')}
                </div>
              </div>
            )
            : (
              <div className={cn('system-md-semibold mb-0.5 text-text-secondary', 'flex items-center justify-between')}>
                <div>{t('datasetSettings.form.retrievalSetting.title')}</div>
              </div>
            )}

          <div className=''>
            {
              getIndexing_technique() === IndexingType.QUALIFIED
                ? (
                  <RetrievalMethodConfig
                    disabled={isModelAndRetrievalConfigDisabled}
                    value={retrievalConfig}
                    onChange={setRetrievalConfig}
                  />
                )
                : (
                  <EconomicalRetrievalMethodConfig
                    disabled={isModelAndRetrievalConfigDisabled}
                    value={retrievalConfig}
                    onChange={setRetrievalConfig}
                  />
                )
            }
          </div>
        </div>

        {!isSetting
          ? (
            <div className='mt-8 flex items-center py-2'>
              <Button onClick={() => onStepChange && onStepChange(-1)}>
                <RiArrowLeftLine className='mr-1 h-4 w-4' />
                {t('datasetCreation.stepTwo.previousStep')}
              </Button>
              <Button className='ml-auto' loading={isCreating} variant='primary' onClick={createHandle}>{t('datasetCreation.stepTwo.nextStep')}</Button>
            </div>
          )
          : (
            <div className='mt-8 flex items-center py-2'>
              <Button loading={isCreating} variant='primary' onClick={createHandle}>{t('datasetCreation.stepTwo.save')}</Button>
              <Button className='ml-2' onClick={onCancel}>{t('datasetCreation.stepTwo.cancel')}</Button>
            </div>
          )}
      </div>
      <FloatRightContainer isMobile={isMobile} isOpen={true} onClose={noop} footer={null}>
        <PreviewContainer
          header={<PreviewHeader
            title={t('datasetCreation.stepTwo.preview')}
          >
            <div className='flex items-center gap-1'>
              {dataSourceType === DataSourceType.FILE
                && <PreviewDocumentPicker
                  files={files as Array<Required<CustomFile>>}
                  onChange={(selected) => {
                    currentEstimateMutation.reset()
                    setPreviewFile(selected)
                    currentEstimateMutation.mutate()
                  }}
                  // when it is from setting, it just has one file
                  value={isSetting ? (files[0]! as Required<CustomFile>) : previewFile}
                />
              }
              {dataSourceType === DataSourceType.NOTION
                && <PreviewDocumentPicker
                  files={
                    notionPages.map(page => ({
                      id: page.page_id,
                      name: page.page_name,
                      extension: 'md',
                    }))
                  }
                  onChange={(selected) => {
                    currentEstimateMutation.reset()
                    const selectedPage = notionPages.find(page => page.page_id === selected.id)
                    setPreviewNotionPage(selectedPage!)
                    currentEstimateMutation.mutate()
                  }}
                  value={{
                    id: previewNotionPage?.page_id || '',
                    name: previewNotionPage?.page_name || '',
                    extension: 'md',
                  }}
                />
              }
              {dataSourceType === DataSourceType.WEB
                && <PreviewDocumentPicker
                  files={
                    websitePages.map(page => ({
                      id: page.source_url,
                      name: page.title,
                      extension: 'md',
                    }))
                  }
                  onChange={(selected) => {
                    currentEstimateMutation.reset()
                    const selectedPage = websitePages.find(page => page.source_url === selected.id)
                    setPreviewWebsitePage(selectedPage!)
                    currentEstimateMutation.mutate()
                  }}
                  value={
                    {
                      id: previewWebsitePage?.source_url || '',
                      name: previewWebsitePage?.title || '',
                      extension: 'md',
                    }
                  }
                />
              }
              {
                currentDocForm !== ChunkingMode.qa
                && <Badge text={t('datasetCreation.stepTwo.previewChunkCount', {
                  count: estimate?.total_segments || 0,
                }) as string}
                />
              }
            </div>
          </PreviewHeader>}
          className={cn('relative flex h-full w-1/2 shrink-0 p-4 pr-0', isMobile && 'w-full max-w-[524px]')}
          mainClassName='space-y-6'
        >
          {currentDocForm === ChunkingMode.qa && estimate?.qa_preview && (
            estimate?.qa_preview.map((item, index) => (
              <ChunkContainer
                key={item.question}
                label={`Chunk-${index + 1}`}
                characterCount={item.question.length + item.answer.length}
              >
                <QAPreview qa={item} />
              </ChunkContainer>
            ))
          )}
          {currentDocForm === ChunkingMode.text && estimate?.preview && (
            estimate?.preview.map((item, index) => (
              <ChunkContainer
                key={item.content}
                label={`Chunk-${index + 1}`}
                characterCount={item.content.length}
              >
                {item.content}
              </ChunkContainer>
            ))
          )}
          {currentDocForm === ChunkingMode.parentChild && currentEstimateMutation.data?.preview && (
            estimate?.preview?.map((item, index) => {
              const indexForLabel = index + 1
              const childChunks = parentChildConfig.chunkForContext === 'full-doc'
                ? item.child_chunks.slice(0, FULL_DOC_PREVIEW_LENGTH)
                : item.child_chunks
              return (
                <ChunkContainer
                  key={item.content}
                  label={`Chunk-${indexForLabel}`}
                  characterCount={item.content.length}
                >
                  <FormattedText>
                    {childChunks.map((child, index) => {
                      const indexForLabel = index + 1
                      return (
                        <PreviewSlice
                          key={`C-${indexForLabel}-${child}`}
                          label={`C-${indexForLabel}`}
                          text={child}
                          tooltip={`Child-chunk-${indexForLabel} · ${child.length} Characters`}
                          labelInnerClassName='text-[10px] font-semibold align-bottom leading-7'
                          dividerClassName='leading-7'
                        />
                      )
                    })}
                  </FormattedText>
                </ChunkContainer>
              )
            })
          )}
          {currentEstimateMutation.isIdle && (
            <div className='flex h-full w-full items-center justify-center'>
              <div className='flex flex-col items-center justify-center gap-3'>
                <RiSearchEyeLine className='size-10 text-text-empty-state-icon' />
                <p className='text-sm text-text-tertiary'>
                  {t('datasetCreation.stepTwo.previewChunkTip')}
                </p>
              </div>
            </div>
          )}
          {currentEstimateMutation.isPending && (
            <div className='space-y-6'>
              {Array.from({ length: 10 }, (_, i) => (
                <SkeletonContainer key={i}>
                  <SkeletonRow>
                    <SkeletonRectangle className="w-20" />
                    <SkeletonPoint />
                    <SkeletonRectangle className="w-24" />
                  </SkeletonRow>
                  <SkeletonRectangle className="w-full" />
                  <SkeletonRectangle className="w-full" />
                  <SkeletonRectangle className="w-[422px]" />
                </SkeletonContainer>
              ))}
            </div>
          )}
        </PreviewContainer>
      </FloatRightContainer>
    </div>
  )
}

export default StepTwo
