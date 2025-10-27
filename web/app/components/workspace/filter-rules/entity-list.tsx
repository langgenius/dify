'use client'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiSearchLine,
} from '@remixicon/react'
import type { FilterEntity } from './types'
import { EntityType } from './types'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Confirm from '@/app/components/base/confirm'

type EntityListProps = {
  entities: FilterEntity[]
  type: EntityType
  onEdit: (entity: FilterEntity) => void
  onDelete: (name: string) => void
  isLoading?: boolean
}

const EntityList: FC<EntityListProps> = ({
  entities,
  type,
  onEdit,
  onDelete,
  isLoading = false,
}) => {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteConfirmEntity, setDeleteConfirmEntity] = useState<string | null>(null)

  const filteredEntities = entities.filter((entity) => {
    if (!searchQuery)
      return true
    return entity.name.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const handleDelete = (name: string) => {
    setDeleteConfirmEntity(name)
  }

  const confirmDelete = () => {
    if (deleteConfirmEntity) {
      onDelete(deleteConfirmEntity)
      setDeleteConfirmEntity(null)
    }
  }

  const isBaseEntity = type === EntityType.BASE_ENTITY

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="mb-4">
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('filterRules.searchPlaceholder')}
          prefix={<RiSearchLine className="h-4 w-4 text-gray-400" />}
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-gray-200">
        <table className="w-full">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                {isBaseEntity ? t('filterRules.entityName') : t('filterRules.attributeName')}
              </th>
              {!isBaseEntity && (
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  {t('filterRules.attributeType')}
                </th>
              )}
              <th className="w-24 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                {t('filterRules.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {isLoading
              ? (
                <tr>
                  <td colSpan={isBaseEntity ? 2 : 3} className="px-4 py-8 text-center text-gray-500">
                    {t('filterRules.loading')}
                  </td>
                </tr>
              )
              : filteredEntities.length === 0
                ? (
                  <tr>
                    <td colSpan={isBaseEntity ? 2 : 3} className="px-4 py-8 text-center text-gray-500">
                      {searchQuery ? t('filterRules.noSearchResults') : t('filterRules.noData')}
                    </td>
                  </tr>
                )
                : (
                  filteredEntities.map((entity, index) => (
                    <tr key={`${entity.name}-${index}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {entity.name}
                      </td>
                      {!isBaseEntity && (
                        <td className="px-4 py-3 text-sm text-gray-600">
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                            {entity.attribute_type || '-'}
                          </span>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right text-sm font-medium">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="small"
                            variant="ghost"
                            onClick={() => onEdit(entity)}
                            className="!p-1.5"
                          >
                            <RiEditLine className="h-4 w-4 text-gray-500" />
                          </Button>
                          <Button
                            size="small"
                            variant="ghost"
                            onClick={() => handleDelete(entity.name)}
                            className="!p-1.5"
                          >
                            <RiDeleteBinLine className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
          </tbody>
        </table>
      </div>

      {/* Statistics */}
      <div className="mt-3 text-xs text-gray-500">
        {t('filterRules.totalCount', { count: filteredEntities.length })}
        {searchQuery && ` (${t('filterRules.filtered')})`}
      </div>

      {/* Delete Confirmation */}
      {deleteConfirmEntity && (
        <Confirm
          isShow
          onCancel={() => setDeleteConfirmEntity(null)}
          onConfirm={confirmDelete}
          title={t('filterRules.deleteConfirmTitle')}
          content={t('filterRules.deleteConfirmContent', { name: deleteConfirmEntity })}
        />
      )}
    </div>
  )
}

export default EntityList
