export type FilterEntity = {
  name: string
  attribute_type?: string
}

export type FilterRulesData = {
  entities: FilterEntity[]
  attributes: FilterEntity[]
}

export enum EntityType {
  BASE_ENTITY = 'base_entity',
  ATTRIBUTE = 'attribute',
}

export type EditingEntity = {
  name: string
  attribute_type?: string
  isNew: boolean
  originalName?: string
}

export const ATTRIBUTE_TYPES = [
  { value: '尺寸', label: '尺寸' },
  { value: '颜色', label: '颜色' },
  { value: '版本', label: '版本' },
  { value: '款式', label: '款式' },
  { value: '产品定位', label: '产品定位' },
] as const

export type AttributeType = typeof ATTRIBUTE_TYPES[number]['value']
