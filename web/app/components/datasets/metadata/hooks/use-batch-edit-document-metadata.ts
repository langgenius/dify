import { useBoolean } from 'ahooks'
import type { MetadataItemInBatchEdit, MetadataItemWithValue } from '../types'
import { DataType } from '../types'
import type { SimpleDocumentDetail } from '@/models/datasets'
import { useMemo } from 'react'

// compare
// original and edited list.
// Use the edited list, except the original and edited value is both multiple value.
const testMetadataList: MetadataItemWithValue[][] = [
  [
    { id: 'str-same-value', name: 'name', type: DataType.string, value: 'Joel' },
    { id: 'num', name: 'age', type: DataType.number, value: 10 },
    { id: 'str-with-different-value', name: 'hobby', type: DataType.string, value: 'bbb' },
  ],
  [
    { id: 'str-same-value', name: 'name', type: DataType.string, value: 'Joel' },
    { id: 'str-with-different-value', name: 'hobby', type: DataType.string, value: 'ccc' },
  ],
]

type Props = {
  list: SimpleDocumentDetail[]
}

const useBatchEditDocumentMetadata = ({
  list,
}: Props) => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  const originalList = useMemo(() => {
    const idNameValue: Record<string, { value: string | number | null, isMultipleValue: boolean }> = {}
    // TODO: mock backend data struct
    // const metaDataList: MetadataItemWithValue[][] = list.map((item, i) => {
    //   if (item.doc_metadata)
    //     return item.doc_metadata

    //   return testMetadataList[i] || []
    // })
    const metaDataList = testMetadataList
    const res: MetadataItemInBatchEdit[] = []
    metaDataList.forEach((metaData) => {
      metaData.forEach((item) => {
        // if (item.value === 'ccc') {
        //   debugger
        // }
        if (idNameValue[item.id]?.isMultipleValue)
          return
        const itemInRes = res.find(i => i.id === item.id)
        if (!idNameValue[item.id]) {
          idNameValue[item.id] = {
            value: item.value,
            isMultipleValue: false,
          }
        }

        if (itemInRes && itemInRes.value !== item.value) {
          idNameValue[item.id].isMultipleValue = true
          itemInRes.isMultipleValue = true
          itemInRes.value = null
          return
        }
        if (!itemInRes) {
          res.push({
            ...item,
            isMultipleValue: false,
          })
        }
      })
    })
    return res
  }, [list])

  return {
    isShowEditModal,
    showEditModal,
    hideEditModal,
    originalList,
  }
}

export default useBatchEditDocumentMetadata
