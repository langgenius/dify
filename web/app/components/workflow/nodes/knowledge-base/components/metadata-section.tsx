'use client'
import type { FC } from 'react'
import type { DocMetadataItem } from '../types'
import type { MetadataItemWithValueLength } from '@/app/components/datasets/metadata/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { InputNumber } from '@/app/components/base/input-number'
import Tooltip from '@/app/components/base/tooltip'
import Datepicker from '@/app/components/datasets/metadata/base/date-picker'
import { DataType } from '@/app/components/datasets/metadata/types'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

type ConstantValueInputProps = {
  metadataType: DataType | undefined
  value: string | number | string[] | null
  onChange: (value: string | number | null) => void
  readonly?: boolean
  placeholder: string
}

const ConstantValueInput: FC<ConstantValueInputProps> = ({
  metadataType,
  value,
  onChange,
  readonly,
  placeholder,
}) => {
  if (metadataType === DataType.time) {
    const timeValue = typeof value === 'number' ? value : undefined
    return (
      <Datepicker
        className="h-full w-full"
        value={timeValue}
        onChange={v => onChange(v)}
      />
    )
  }

  if (metadataType === DataType.number) {
    return (
      <InputNumber
        className="h-full w-full border-none bg-transparent p-0"
        value={typeof value === 'number' ? value : undefined}
        onChange={v => onChange(v)}
        readOnly={readonly}
        size="regular"
      />
    )
  }

  return (
    <input
      type="text"
      value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={readonly}
      className="h-full w-full bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-placeholder disabled:opacity-50"
    />
  )
}

type MetadataSectionProps = {
  nodeId: string
  userMetadata?: MetadataItemWithValueLength[]
  docMetadata?: DocMetadataItem[]
  onDocMetadataChange?: (metadata: DocMetadataItem[]) => void
  readonly?: boolean
  className?: string
}

const MetadataSection: FC<MetadataSectionProps> = ({
  nodeId,
  userMetadata = [],
  docMetadata = [],
  onDocMetadataChange,
  readonly,
  className,
}) => {
  const { t } = useTranslation()

  // Document metadata value handlers
  const handleAddDocMetadata = useCallback(() => {
    if (onDocMetadataChange) {
      onDocMetadataChange([...docMetadata, { metadata_id: '', value: '' }])
    }
  }, [docMetadata, onDocMetadataChange])

  const handleRemoveDocMetadata = useCallback((index: number) => {
    if (onDocMetadataChange) {
      const newMetadata = [...docMetadata]
      newMetadata.splice(index, 1)
      onDocMetadataChange(newMetadata)
    }
  }, [docMetadata, onDocMetadataChange])

  const handleDocMetadataIdChange = useCallback((index: number, metadataId: string) => {
    if (onDocMetadataChange) {
      const newMetadata = [...docMetadata]
      newMetadata[index] = { ...newMetadata[index], metadata_id: metadataId }
      onDocMetadataChange(newMetadata)
    }
  }, [docMetadata, onDocMetadataChange])

  const handleDocMetadataValueChange = useCallback((index: number, value: string | number | ValueSelector | null) => {
    if (onDocMetadataChange) {
      const newMetadata = [...docMetadata]
      newMetadata[index] = { ...newMetadata[index], value }
      onDocMetadataChange(newMetadata)
    }
  }, [docMetadata, onDocMetadataChange])

  const getAvailableMetadataOptions = useCallback((currentId: string) => {
    const usedIds = docMetadata.map(m => m.metadata_id).filter(id => id !== currentId)
    return userMetadata.filter(m => !usedIds.includes(m.id))
  }, [userMetadata, docMetadata])

  const getMetadataType = useCallback((metadataId: string): DataType | undefined => {
    return userMetadata.find(m => m.id === metadataId)?.type
  }, [userMetadata])

  // Filter variables based on metadata type
  const createVarFilter = useCallback((metadataId: string) => {
    return (variable: Var): boolean => {
      const metadataType = getMetadataType(metadataId)

      if (!metadataType)
        return false

      // Type mapping: Metadata DataType -> Workflow VarType
      switch (metadataType) {
        case DataType.string:
          return variable.type === VarType.string
        case DataType.number:
          return variable.type === VarType.number || variable.type === VarType.integer
        case DataType.time:
          return variable.type === VarType.number
        default:
          return false
      }
    }
  }, [getMetadataType])

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="text-text-tertiary system-xs-semibold-uppercase">
          {t('metadata.metadata', { ns: 'dataset' })}
        </div>
      </div>

      {/* Document Metadata Values Section */}
      {userMetadata.length > 0 && (
        <div className="space-y-2 rounded-lg border border-components-panel-border bg-components-panel-bg p-3">
          <div className="flex items-center justify-end">
            {!readonly && (
              <button
                type="button"
                onClick={handleAddDocMetadata}
                className="flex items-center gap-1 text-text-accent-secondary system-xs-medium hover:text-text-accent disabled:opacity-50"
                disabled={docMetadata.length >= userMetadata.length}
              >
                <div className="i-ri-add-line size-3.5" />
                {t('operation.add', { ns: 'common' })}
              </button>
            )}
          </div>

          {docMetadata.length > 0
            ? (
                <div className="space-y-2">
                  {docMetadata.map((item, index) => {
                    const isVariable = Array.isArray(item.value)
                    const itemKey = item.metadata_id ? `metadata-${item.metadata_id}` : `new-${index}`
                    return (
                      <div key={itemKey} className="flex items-center gap-2">
                        <div className="flex w-0 grow items-center gap-2">
                          <div className="flex w-1/3 items-center gap-1 rounded-lg border border-components-panel-border bg-components-input-bg-normal px-2">
                            <select
                              value={item.metadata_id}
                              onChange={e => handleDocMetadataIdChange(index, e.target.value)}
                              disabled={readonly}
                              className="h-8 w-full appearance-none bg-transparent text-[13px] text-text-primary outline-none disabled:opacity-50"
                            >
                              <option value="" disabled>{t('placeholder.select', { ns: 'common' })}</option>
                              {getAvailableMetadataOptions(item.metadata_id).map(opt => (
                                <option key={opt.id} value={opt.id}>{opt.name}</option>
                              ))}
                              {item.metadata_id && !getAvailableMetadataOptions(item.metadata_id).find(o => o.id === item.metadata_id) && (
                                <option value={item.metadata_id}>{userMetadata.find(m => m.id === item.metadata_id)?.name}</option>
                              )}
                            </select>
                          </div>
                          <div className="flex h-8 grow items-center gap-1 rounded-lg border border-components-panel-border bg-components-input-bg-normal">
                            <div className="ml-1 inline-flex shrink-0 gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5">
                              <Tooltip
                                popupContent={isVariable ? '' : t('nodes.common.valueType.variable', { ns: 'workflow' })}
                              >
                                <div
                                  className={cn('cursor-pointer rounded-lg px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover', isVariable && 'bg-components-segmented-control-item-active-bg text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg', readonly && 'cursor-not-allowed opacity-50')}
                                  onClick={() => !readonly && handleDocMetadataValueChange(index, [])}
                                >
                                  <div className="i-custom-vender-solid-development-variable-02 h-4 w-4" />
                                </div>
                              </Tooltip>
                              <Tooltip
                                popupContent={isVariable ? t('nodes.common.valueType.constant', { ns: 'workflow' }) : ''}
                              >
                                <div
                                  className={cn('cursor-pointer rounded-lg px-2.5 py-1.5 text-text-tertiary hover:bg-state-base-hover', !isVariable && 'bg-components-segmented-control-item-active-bg text-text-secondary shadow-xs hover:bg-components-segmented-control-item-active-bg', readonly && 'cursor-not-allowed opacity-50')}
                                  onClick={() => !readonly && handleDocMetadataValueChange(index, '')}
                                >
                                  <div className="i-ri-edit-line h-4 w-4" />
                                </div>
                              </Tooltip>
                            </div>
                            <div className="h-full w-px bg-divider-regular" />
                            <div className="w-0 grow overflow-hidden">
                              {isVariable
                                ? (
                                    <VarReferencePicker
                                      nodeId={nodeId}
                                      readonly={readonly || false}
                                      value={item.value as ValueSelector}
                                      onChange={value => handleDocMetadataValueChange(index, value)}
                                      isSupportConstantValue={false}
                                      isSupportFileVar={false}
                                      placeholder={t('placeholder.input', { ns: 'common' }) || ''}
                                      className="h-full border-none !bg-transparent p-0"
                                      zIndex={1000}
                                      isShowNodeName
                                      minWidth={360}
                                      filterVar={createVarFilter(item.metadata_id)}
                                    />
                                  )
                                : (
                                    <div className="flex h-full w-full items-center px-2">
                                      <ConstantValueInput
                                        metadataType={getMetadataType(item.metadata_id)}
                                        value={item.value}
                                        onChange={value => handleDocMetadataValueChange(index, value)}
                                        readonly={readonly}
                                        placeholder={t('placeholder.input', { ns: 'common' }) || ''}
                                      />
                                    </div>
                                  )}
                            </div>
                          </div>
                        </div>
                        {!readonly && (
                          <button
                            type="button"
                            onClick={() => handleRemoveDocMetadata(index)}
                            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
                          >
                            <div className="i-ri-delete-bin-line size-4" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            : (
                <div className="py-2 text-center text-text-quaternary system-2xs-regular">
                  {t('stepTwo.metadata.noValues', { ns: 'datasetCreation' })}
                </div>
              )}
        </div>
      )}

    </div>
  )
}

export default MetadataSection
