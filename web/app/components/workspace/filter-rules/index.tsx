'use client'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import {
  RiAddLine,
  RiDownloadLine,
} from '@remixicon/react'
import type { EditingEntity, FilterEntity } from './types'
import { EntityType } from './types'
import EntityList from './entity-list'
import EditEntityModal from './edit-entity-modal'
import {
  addFilterEntity,
  deleteFilterEntity,
  fetchFilterRules,
  updateFilterEntity,
} from '@/service/filter-rules'
import Button from '@/app/components/base/button'
import { useToastContext } from '@/app/components/base/toast'

const FilterRulesManagement: FC = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()

  // Fetch data
  const { data, error, mutate, isLoading } = useSWR('filter-rules', fetchFilterRules)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingEntityType, setEditingEntityType] = useState<EntityType>(EntityType.BASE_ENTITY)
  const [editingEntity, setEditingEntity] = useState<FilterEntity | undefined>()

  // Add entity
  const handleAddEntity = (type: EntityType) => {
    setEditingEntityType(type)
    setEditingEntity(undefined)
    setShowModal(true)
  }

  // Edit entity
  const handleEditEntity = (entity: FilterEntity, type: EntityType) => {
    setEditingEntityType(type)
    setEditingEntity(entity)
    setShowModal(true)
  }

  // Save entity (add or update)
  const handleSaveEntity = async (entity: EditingEntity) => {
    try {
      if (entity.isNew) {
        // Add new entity
        await addFilterEntity({
          name: entity.name,
          attribute_type: entity.attribute_type,
        })
        notify({ type: 'success', message: t('filterRules.addSuccess') })
      }
      else {
        // Update existing entity
        await updateFilterEntity({
          old_name: entity.originalName!,
          new_name: entity.name,
          attribute_type: entity.attribute_type,
        })
        notify({ type: 'success', message: t('filterRules.updateSuccess') })
      }
      mutate()
    }
    catch (err: any) {
      notify({ type: 'error', message: err.message || t('filterRules.saveFailed') })
      throw err
    }
  }

  // Delete entity
  const handleDeleteEntity = async (name: string) => {
    try {
      await deleteFilterEntity({ name })
      notify({ type: 'success', message: t('filterRules.deleteSuccess') })
      mutate()
    }
    catch (err: any) {
      notify({ type: 'error', message: err.message || t('filterRules.deleteFailed') })
    }
  }

  // Export to CSV
  const handleExport = () => {
    if (!data)
      return

    const allItems = [...data.entities, ...data.attributes]
    const csvContent = `实体,属性类型\n${allItems.map(item => `${item.name},${item.attribute_type || ''}`).join('\n')}`

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `filter_rules_${new Date().toISOString().split('T')[0]}.csv`
    link.click()

    notify({ type: 'success', message: t('filterRules.exportSuccess') })
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-500">{t('filterRules.loadError')}</p>
          <Button onClick={() => mutate()}>{t('common.operation.retry')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {t('filterRules.title')}
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              {t('filterRules.description')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleExport}
              disabled={isLoading || !data}
            >
              <RiDownloadLine className="mr-1 h-4 w-4" />
              {t('filterRules.export')}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="grid flex-1 grid-cols-2 gap-6 overflow-hidden">
        {/* Base Entities */}
        <div className="flex flex-col rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('filterRules.baseEntities')}
            </h2>
            <Button
              size="small"
              variant="primary"
              onClick={() => handleAddEntity(EntityType.BASE_ENTITY)}
            >
              <RiAddLine className="mr-1 h-4 w-4" />
              {t('filterRules.addEntity')}
            </Button>
          </div>
          <EntityList
            entities={data?.entities || []}
            type={EntityType.BASE_ENTITY}
            onEdit={entity => handleEditEntity(entity, EntityType.BASE_ENTITY)}
            onDelete={handleDeleteEntity}
            isLoading={isLoading}
          />
        </div>

        {/* Attributes */}
        <div className="flex flex-col rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              {t('filterRules.attributes')}
            </h2>
            <Button
              size="small"
              variant="primary"
              onClick={() => handleAddEntity(EntityType.ATTRIBUTE)}
            >
              <RiAddLine className="mr-1 h-4 w-4" />
              {t('filterRules.addAttribute')}
            </Button>
          </div>
          <EntityList
            entities={data?.attributes || []}
            type={EntityType.ATTRIBUTE}
            onEdit={entity => handleEditEntity(entity, EntityType.ATTRIBUTE)}
            onDelete={handleDeleteEntity}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* Edit Modal */}
      {showModal && (
        <EditEntityModal
          isShow={showModal}
          entityType={editingEntityType}
          editingEntity={editingEntity}
          onClose={() => setShowModal(false)}
          onSave={handleSaveEntity}
        />
      )}
    </div>
  )
}

export default FilterRulesManagement
