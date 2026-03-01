'use client'
import type { FC } from 'react'
import type { metadataType } from '@/hooks/use-metadata'
import type { FullDocumentDetail } from '@/models/datasets'
import { get } from 'es-toolkit/compat'
import { useBookCategories, useBusinessDocCategories, useLanguages, useMetadataMap, usePersonalDocCategories } from '@/hooks/use-metadata'
import FieldInfo from './field-info'

const map2Options = (map: Record<string, string>) => {
  return Object.keys(map).map(key => ({ value: key, name: map[key] }))
}

function useCategoryMapResolver(mainField: metadataType | '') {
  const languageMap = useLanguages()
  const bookCategoryMap = useBookCategories()
  const personalDocCategoryMap = usePersonalDocCategories()
  const businessDocCategoryMap = useBusinessDocCategories()

  return (field: string): Record<string, string> => {
    if (field === 'language')
      return languageMap
    if (field === 'category' && mainField === 'book')
      return bookCategoryMap
    if (field === 'document_type') {
      if (mainField === 'personal_document')
        return personalDocCategoryMap
      if (mainField === 'business_document')
        return businessDocCategoryMap
    }
    return {}
  }
}

type MetadataFieldListProps = {
  mainField: metadataType | ''
  canEdit?: boolean
  metadata?: Record<string, string>
  docDetail?: FullDocumentDetail
  onFieldUpdate?: (field: string, value: string) => void
}

const MetadataFieldList: FC<MetadataFieldListProps> = ({
  mainField,
  canEdit = false,
  metadata,
  docDetail,
  onFieldUpdate,
}) => {
  const metadataMap = useMetadataMap()
  const getCategoryMap = useCategoryMapResolver(mainField)

  if (!mainField)
    return null

  const fieldMap = metadataMap[mainField]?.subFieldsMap
  const isFixedField = ['originInfo', 'technicalParameters'].includes(mainField)
  const sourceData = isFixedField ? docDetail : metadata

  const getDisplayValue = (field: string) => {
    const val = get(sourceData, field, '')
    if (!val && val !== 0)
      return '-'
    if (fieldMap[field]?.inputType === 'select')
      return getCategoryMap(field)[val]
    if (fieldMap[field]?.render)
      return fieldMap[field]?.render?.(val, field === 'hit_count' ? get(sourceData, 'segment_count', 0) as number : undefined)
    return val
  }

  return (
    <div className="flex flex-col gap-1">
      {Object.keys(fieldMap).map(field => (
        <FieldInfo
          key={fieldMap[field]?.label}
          label={fieldMap[field]?.label}
          displayedValue={getDisplayValue(field)}
          value={get(sourceData, field, '')}
          inputType={fieldMap[field]?.inputType || 'input'}
          showEdit={canEdit}
          onUpdate={val => onFieldUpdate?.(field, val)}
          selectOptions={map2Options(getCategoryMap(field))}
        />
      ))}
    </div>
  )
}

export default MetadataFieldList
