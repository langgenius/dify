import type { FC } from 'react'
import type { MetadataState } from '../hooks'
import type { metadataType } from '@/hooks/use-metadata'
import type { FullDocumentDetail } from '@/models/datasets'
import { get } from 'es-toolkit/compat'
import { memo } from 'react'
import { useBookCategories, useBusinessDocCategories, useLanguages, useMetadataMap, usePersonalDocCategories } from '@/hooks/use-metadata'
import FieldInfo from './field-info'
import { map2Options } from './utils'

export type MetadataFieldListProps = {
  mainField: metadataType | ''
  canEdit: boolean
  docDetail?: FullDocumentDetail
  metadataParams: MetadataState
  onUpdateField: (field: string, value: string) => void
}

const MetadataFieldList: FC<MetadataFieldListProps> = ({
  mainField,
  canEdit,
  docDetail,
  metadataParams,
  onUpdateField,
}) => {
  const metadataMap = useMetadataMap()
  const languageMap = useLanguages()
  const bookCategoryMap = useBookCategories()
  const personalDocCategoryMap = usePersonalDocCategories()
  const businessDocCategoryMap = useBusinessDocCategories()

  if (!mainField)
    return null

  const fieldMap = metadataMap[mainField]?.subFieldsMap
  const sourceData = ['originInfo', 'technicalParameters'].includes(mainField) ? docDetail : metadataParams.metadata

  const getTargetMap = (field: string): Record<string, string> => {
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

  const getTargetValue = (field: string): string => {
    const val = get(sourceData, field, '')
    if (!val && val !== 0)
      return '-'
    if (fieldMap[field]?.inputType === 'select')
      return getTargetMap(field)[val as string] || '-'
    if (fieldMap[field]?.render) {
      const rendered = fieldMap[field]?.render?.(val, field === 'hit_count' ? get(sourceData, 'segment_count', 0) as number : undefined)
      return typeof rendered === 'string' ? rendered : String(rendered ?? '-')
    }
    return String(val)
  }

  return (
    <div className="flex flex-col gap-1">
      {Object.keys(fieldMap).map(field => (
        <FieldInfo
          key={fieldMap[field]?.label}
          label={fieldMap[field]?.label}
          displayedValue={getTargetValue(field)}
          value={get(sourceData, field, '')}
          inputType={fieldMap[field]?.inputType || 'input'}
          showEdit={canEdit}
          onUpdate={(val) => {
            onUpdateField(field, val)
          }}
          selectOptions={map2Options(getTargetMap(field))}
        />
      ))}
    </div>
  )
}

export default memo(MetadataFieldList)
