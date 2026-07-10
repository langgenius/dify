'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { getDatasetACLCapabilities } from '@/utils/permission'
import Item from './dataset-item'

type Props = Readonly<{
  list: DataSet[]
  onChange: (list: DataSet[]) => void
  readonly?: boolean
  settingsDrawerBackdropClassName?: string
  settingsDrawerBackdropForceRender?: boolean
  settingsDrawerPopupClassName?: string
  settingsModalHeight?: string
}>

const DatasetList: FC<Props> = ({
  list,
  onChange,
  readonly,
  settingsDrawerBackdropClassName,
  settingsDrawerBackdropForceRender,
  settingsDrawerPopupClassName,
  settingsModalHeight,
}) => {
  const { t } = useTranslation()
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

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
      const datasetACLCapabilities = getDatasetACLCapabilities(item.permission_keys, {
        currentUserId,
        resourceMaintainer: item.maintainer,
        workspacePermissionKeys,
      })
      return {
        ...item,
        editable: datasetACLCapabilities.canEdit,
      }
    })
  }, [currentUserId, list, workspacePermissionKeys])

  return (
    <div className="space-y-1">
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
                settingsDrawerBackdropClassName={settingsDrawerBackdropClassName}
                settingsDrawerBackdropForceRender={settingsDrawerBackdropForceRender}
                settingsDrawerPopupClassName={settingsDrawerPopupClassName}
                settingsModalHeight={settingsModalHeight}
              />
            )
          })
        : (
            <div className="cursor-default rounded-lg bg-background-section p-3 text-center text-xs text-text-tertiary select-none">
              {t($ => $['datasetConfig.knowledgeTip'], { ns: 'appDebug' })}
            </div>
          )}

    </div>
  )
}
export default React.memo(DatasetList)
