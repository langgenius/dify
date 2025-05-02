'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import produce from 'immer'
import { useTranslation } from 'react-i18next'
import Item from './dataset-item'
import type { DataSet } from '@/models/datasets'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { hasEditPermissionForDataset } from '@/utils/permission'

type Props = {
  list: DataSet[]
  onChange: (list: DataSet[]) => void
  readonly?: boolean
}

const DatasetList: FC<Props> = ({
  list,
  onChange,
  readonly,
}) => {
  const { t } = useTranslation()
  const userProfile = useAppContextSelector(s => s.userProfile)

  const handleRemove = useCallback((index: number) => {
    return () => {
      const newList = produce(list, (draft) => {
        draft.splice(index, 1)
      })
      onChange(newList)
    }
  }, [list, onChange])

  const handleChange = useCallback((index: number) => {
    return (value: DataSet) => {
      const newList = produce(list, (draft) => {
        draft[index] = value
      })
      onChange(newList)
    }
  }, [list, onChange])

  const formattedList = useMemo(() => {
    return list.map((item) => {
      const datasetConfig = {
        createdBy: item.created_by,
        partialMemberList: item.partial_member_list || [],
        permission: item.permission,
      }
      return {
        ...item,
        editable: hasEditPermissionForDataset(userProfile?.id || '', datasetConfig),
      }
    })
  }, [list, userProfile?.id])

  return (
    <div className='space-y-1'>
      {formattedList.length
        ? formattedList.map((item, index) => {
          return (
            <Item
              key={index}
              payload={item}
              onRemove={handleRemove(index)}
              onChange={handleChange(index)}
              readonly={readonly}
              editable={item.editable}
            />
          )
        })
        : (
          <div className='p-3 text-xs text-center text-gray-500 rounded-lg cursor-default select-none bg-gray-50'>
            {t('appDebug.datasetConfig.knowledgeTip')}
          </div>
        )
      }

    </div>
  )
}
export default React.memo(DatasetList)
