/* eslint-disable no-mixed-operators */
'use client'
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { XMarkIcon } from '@heroicons/react/20/solid'
import cn from 'classnames'
import Link from 'next/link'
import { groupBy } from 'lodash-es'
import PreviewItem from './preview-item'
import s from './index.module.css'
import type { CreateDocumentReq, File, FullDocumentDetail, FileIndexingEstimateResponse as IndexingEstimateResponse, NotionInfo, PreProcessingRule, Rules, createDocumentResponse } from '@/models/datasets'
import {
  createDocument,
  createFirstDocument,
  fetchFileIndexingEstimate as didFetchFileIndexingEstimate,
  fetchDefaultProcessRule,
} from '@/service/datasets'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'

import Toast from '@/app/components/base/toast'
import { formatNumber } from '@/utils/format'
import type { DataSourceNotionPage } from '@/models/common'
import { DataSourceType } from '@/models/datasets'
import NotionIcon from '@/app/components/base/notion-icon'
import { useDatasetDetailContext } from '@/context/dataset-detail'

type Page = DataSourceNotionPage & { workspace_id: string }

type StepTwoProps = {
  isSetting?: boolean
  documentDetail?: FullDocumentDetail
  hasSetAPIKEY: boolean
  onSetting: () => void
  datasetId?: string
  indexingType?: string
  dataSourceType: DataSourceType
  file?: File
  notionPages?: Page[]
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

const StepTwo = ({
  isSetting,
  documentDetail,
  hasSetAPIKEY,
  onSetting,
  datasetId,
  indexingType,
  dataSourceType,
  file,
  notionPages = [],
  onStepChange,
  updateIndexingTypeCache,
  updateResultCache,
  onSave,
  onCancel,
}: StepTwoProps) => {
  const { t } = useTranslation()
  const { mutateDatasetRes } = useDatasetDetailContext()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const [previewScrolled, setPreviewScrolled] = useState(false)
  const [segmentationType, setSegmentationType] = useState<SegmentType>(SegmentType.AUTO)
  const [segmentIdentifier, setSegmentIdentifier] = useState('\\n')
  const [max, setMax] = useState(1000)
  const [rules, setRules] = useState<PreProcessingRule[]>([])
  const [defaultConfig, setDefaultConfig] = useState<Rules>()
  const hasSetIndexType = !!indexingType
  const [indexType, setIndexType] = useState<IndexingType>(
    indexingType
      || hasSetAPIKEY
      ? IndexingType.QUALIFIED
      : IndexingType.ECONOMICAL,
  )
  const [showPreview, { setTrue: setShowPreview, setFalse: hidePreview }] = useBoolean()
  const [customFileIndexingEstimate, setCustomFileIndexingEstimate] = useState<IndexingEstimateResponse | null>(null)
  const [automaticFileIndexingEstimate, setAutomaticFileIndexingEstimate] = useState<IndexingEstimateResponse | null>(null)
  const fileIndexingEstimate = (() => {
    return segmentationType === SegmentType.AUTO ? automaticFileIndexingEstimate : customFileIndexingEstimate
  })()

  const scrollHandle = (e: any) => {
    if (e.target.scrollTop > 0)
      setScrolled(true)

    else
      setScrolled(false)
  }

  const previewScrollHandle = (e: any) => {
    if (e.target.scrollTop > 0)
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
      setSegmentIdentifier(defaultConfig.segmentation.separator === '\n' ? '\\n' : defaultConfig.segmentation.separator || '\\n')
      setMax(defaultConfig.segmentation.max_tokens)
      setRules(defaultConfig.pre_processing_rules)
    }
  }

  const fetchFileIndexingEstimate = async () => {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const res = await didFetchFileIndexingEstimate(getFileIndexingEstimateParams())
    if (segmentationType === SegmentType.CUSTOM)
      setCustomFileIndexingEstimate(res)

    else
      setAutomaticFileIndexingEstimate(res)
  }

  const confirmChangeCustomConfig = async () => {
    setCustomFileIndexingEstimate(null)
    setShowPreview()
    await fetchFileIndexingEstimate()
  }

  const getIndexing_technique = () => indexingType || indexType

  const getProcessRule = () => {
    const processRule: any = {
      rules: {}, // api will check this. It will be removed after api refactored.
      mode: segmentationType,
    }
    if (segmentationType === SegmentType.CUSTOM) {
      const ruleObj = {
        pre_processing_rules: rules,
        segmentation: {
          separator: segmentIdentifier === '\\n' ? '\n' : segmentIdentifier,
          max_tokens: max,
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

  const getFileIndexingEstimateParams = () => {
    let params
    if (dataSourceType === DataSourceType.FILE) {
      params = {
        info_list: {
          data_source_type: dataSourceType,
          file_info_list: {
            // TODO multi files
            file_ids: [file?.id || ''],
          },
        },
        indexing_technique: getIndexing_technique(),
        process_rule: getProcessRule(),
      }
    }
    if (dataSourceType === DataSourceType.NOTION) {
      params = {
        info_list: {
          data_source_type: dataSourceType,
          notion_info_list: getNotionInfo(),
        },
        indexing_technique: getIndexing_technique(),
        process_rule: getProcessRule(),
      }
    }
    return params
  }

  const getCreationParams = () => {
    let params
    if (isSetting) {
      params = {
        original_document_id: documentDetail?.id,
        process_rule: getProcessRule(),
      } as CreateDocumentReq
    }
    else {
      params = {
        data_source: {
          type: dataSourceType,
          info_list: {
            data_source_type: dataSourceType,
          },
        },
        indexing_technique: getIndexing_technique(),
        process_rule: getProcessRule(),
      } as CreateDocumentReq
      if (dataSourceType === DataSourceType.FILE) {
        params.data_source.info_list.file_info_list = {
          // TODO multi files
          file_ids: [file?.id || ''],
        }
      }
      if (dataSourceType === DataSourceType.NOTION)
        params.data_source.info_list.notion_info_list = getNotionInfo()
    }
    return params
  }

  const getRules = async () => {
    try {
      const res = await fetchDefaultProcessRule({ url: '/datasets/process-rule' })
      const separator = res.rules.segmentation.separator
      setSegmentIdentifier(separator === '\n' ? '\\n' : separator || '\\n')
      setMax(res.rules.segmentation.max_tokens)
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
      setSegmentIdentifier(separator === '\n' ? '\\n' : separator || '\\n')
      setMax(max)
      setRules(rules.pre_processing_rules)
      setDefaultConfig(rules)
    }
  }

  const getDefaultMode = () => {
    if (documentDetail)
      setSegmentationType(documentDetail.dataset_process_rule.mode)
  }

  const createHandle = async () => {
    try {
      let res
      const params = getCreationParams()
      if (!datasetId) {
        res = await createFirstDocument({
          body: params,
        })
        updateIndexingTypeCache && updateIndexingTypeCache(indexType)
        updateResultCache && updateResultCache(res)
      }
      else {
        res = await createDocument({
          datasetId,
          body: params,
        })
        updateIndexingTypeCache && updateIndexingTypeCache(indexType)
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
    // get indexing type by props
    if (indexingType)
      setIndexType(indexingType as IndexingType)

    else
      setIndexType(hasSetAPIKEY ? IndexingType.QUALIFIED : IndexingType.ECONOMICAL)
  }, [hasSetAPIKEY, indexingType, datasetId])

  useEffect(() => {
    if (segmentationType === SegmentType.AUTO) {
      setAutomaticFileIndexingEstimate(null)
      setShowPreview()
      fetchFileIndexingEstimate()
    }
    else {
      hidePreview()
      setCustomFileIndexingEstimate(null)
    }
  }, [segmentationType, indexType])

  return (
    <div className='flex w-full h-full'>
      <div ref={scrollRef} className='relative h-full w-full overflow-y-scroll'>
        <div className={cn(s.pageHeader, scrolled && s.fixed)}>{t('datasetCreation.steps.two')}</div>
        <div className={cn(s.form)}>
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
                      <div className={s.label}>{t('datasetCreation.stepTwo.separator')}</div>
                      <input
                        type="text"
                        className={s.input}
                        placeholder={t('datasetCreation.stepTwo.separatorPlaceholder') || ''} value={segmentIdentifier}
                        onChange={e => setSegmentIdentifier(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className={s.formRow}>
                    <div className='w-full'>
                      <div className={s.label}>{t('datasetCreation.stepTwo.maxLength')}</div>
                      <input
                        type="number"
                        className={s.input}
                        placeholder={t('datasetCreation.stepTwo.separatorPlaceholder') || ''} value={max}
                        onChange={e => setMax(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className={s.formRow}>
                    <div className='w-full'>
                      <div className={s.label}>{t('datasetCreation.stepTwo.rules')}</div>
                      {rules.map(rule => (
                        <div key={rule.id} className={s.ruleItem}>
                          <input id={rule.id} type="checkbox" defaultChecked={rule.enabled} onChange={() => ruleChangeHandle(rule.id)} className="w-4 h-4 rounded border-gray-300 text-blue-700 focus:ring-blue-700" />
                          <label htmlFor={rule.id} className="ml-2 text-sm font-normal cursor-pointer text-gray-800">{getRuleName(rule.id)}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className={s.formFooter}>
                    <Button type="primary" className={cn(s.button, '!h-8 text-primary-600')} onClick={confirmChangeCustomConfig}>{t('datasetCreation.stepTwo.preview')}</Button>
                    <Button className={cn(s.button, 'ml-2 !h-8')} onClick={resetRules}>{t('datasetCreation.stepTwo.reset')}</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={s.label}>{t('datasetCreation.stepTwo.indexMode')}</div>
          <div className='max-w-[640px]'>
            <div className='flex items-center gap-3'>
              {(!hasSetIndexType || (hasSetIndexType && indexingType === IndexingType.QUALIFIED)) && (
                <div
                  className={cn(
                    s.radioItem,
                    s.indexItem,
                    !hasSetAPIKEY && s.disabled,
                    !hasSetIndexType && indexType === IndexingType.QUALIFIED && s.active,
                    hasSetIndexType && s.disabled,
                    hasSetIndexType && '!w-full',
                  )}
                  onClick={() => {
                    if (hasSetAPIKEY)
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
                    <div className='pb-0.5 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.emstimateCost')}</div>
                    {
                      fileIndexingEstimate
                        ? (
                          <div className='text-xs font-medium text-gray-800'>{formatNumber(fileIndexingEstimate.tokens)} tokens(<span className='text-yellow-500'>${formatNumber(fileIndexingEstimate.total_price)}</span>)</div>
                        )
                        : (
                          <div className={s.calculating}>{t('datasetCreation.stepTwo.calculating')}</div>
                        )
                    }
                  </div>
                  {!hasSetAPIKEY && (
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
                    hasSetIndexType && '!w-full',
                  )}
                  onClick={() => !hasSetIndexType && setIndexType(IndexingType.ECONOMICAL)}
                >
                  <span className={cn(s.typeIcon, s.economical)} />
                  {!hasSetIndexType && <span className={cn(s.radio)} />}
                  <div className={s.typeHeader}>
                    <div className={s.title}>{t('datasetCreation.stepTwo.economical')}</div>
                    <div className={s.tip}>{t('datasetCreation.stepTwo.economicalTip')}</div>
                    <div className='pb-0.5 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.emstimateCost')}</div>
                    <div className='text-xs font-medium text-gray-800'>0 tokens</div>
                  </div>
                </div>
              )}
            </div>
            {hasSetIndexType && (
              <div className='mt-2 text-xs text-gray-500 font-medium'>
                {t('datasetCreation.stepTwo.indexSettedTip')}
                <Link className='text-[#155EEF]' href={`/datasets/${datasetId}/settings`}>{t('datasetCreation.stepTwo.datasetSettingLink')}</Link>
              </div>
            )}
            {/* TODO multi files */}
            <div className={s.source}>
              <div className={s.sourceContent}>
                {dataSourceType === DataSourceType.FILE && (
                  <>
                    <div className='mb-2 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.fileSource')}</div>
                    <div className='flex items-center text-sm leading-6 font-medium text-gray-800'>
                      <span className={cn(s.fileIcon, file && s[file.extension])} />
                      {getFileName(file?.name || '')}
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
              </div>
              <div className={s.divider} />
              <div className={s.segmentCount}>
                <div className='mb-2 text-xs font-medium text-gray-500'>{t('datasetCreation.stepTwo.emstimateSegment')}</div>
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
                  <Button onClick={() => onStepChange && onStepChange(-1)}>{t('datasetCreation.stepTwo.lastStep')}</Button>
                  <div className={s.divider} />
                  <Button type='primary' onClick={createHandle}>{t('datasetCreation.stepTwo.nextStep')}</Button>
                </div>
              )
              : (
                <div className='flex items-center mt-8 py-2'>
                  <Button type='primary' onClick={createHandle}>{t('datasetCreation.stepTwo.save')}</Button>
                  <Button className='ml-2' onClick={onCancel}>{t('datasetCreation.stepTwo.cancel')}</Button>
                </div>
              )}
          </div>
        </div>
      </div>
      {(showPreview)
        ? (
          <div ref={previewScrollRef} className={cn(s.previewWrap, 'relativeh-full overflow-y-scroll border-l border-[#F2F4F7]')}>
            <div className={cn(s.previewHeader, previewScrolled && `${s.fixed} pb-3`, ' flex items-center justify-between px-8')}>
              <span>{t('datasetCreation.stepTwo.previewTitle')}</span>
              <div className='flex items-center justify-center w-6 h-6 cursor-pointer' onClick={hidePreview}>
                <XMarkIcon className='h-4 w-4'></XMarkIcon>
              </div>
            </div>
            <div className='my-4 px-8 space-y-4'>
              {fileIndexingEstimate?.preview
                ? (
                  <>
                    {fileIndexingEstimate?.preview.map((item, index) => (
                      <PreviewItem key={item} content={item} index={index + 1} />
                    ))}
                  </>
                )
                : <div className='flex items-center justify-center h-[200px]'><Loading type='area'></Loading></div>
              }
            </div>
          </div>
        )
        : (<div className={cn(s.sideTip)}>
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
        </div>)}
    </div>
  )
}

export default StepTwo
