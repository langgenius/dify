'use client'
import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useContext } from 'use-context-selector'
import { BookOpenIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import PermissionsRadio from '../permissions-radio'
import IndexMethodRadio from '../index-method-radio'
import { ToastContext } from '@/app/components/base/toast'
import Button from '@/app/components/base/button'
import { fetchDataDetail, updateDatasetSetting } from '@/service/datasets'
import type { DataSet } from '@/models/datasets'

const rowClass = `
  flex justify-between py-4
`
const labelClass = `
  flex items-center w-[168px] h-9
`
const inputClass = `
  w-[480px] px-3 bg-gray-100 text-sm text-gray-800 rounded-lg outline-none appearance-none
`
const useInitialValue = (depend: any, dispatch: any) => {
  useEffect(() => {
    dispatch(depend)
  }, [depend])
}

type Props = {
  datasetId: string
}

const Form = ({
  datasetId,
}: Props) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { data: currentDataset, mutate: mutateDatasets } = useSWR(datasetId, fetchDataDetail)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(currentDataset?.name ?? '')
  const [description, setDescription] = useState(currentDataset?.description ?? '')
  const [permission, setPermission] = useState(currentDataset?.permission)
  const [indexMethod, setIndexMethod] = useState(currentDataset?.indexing_technique)

  const handleSave = async () => {
    if (loading)
      return
    if (!name?.trim()) {
      notify({ type: 'error', message: t('datasetSettings.form.nameError') })
      return
    }
    try {
      setLoading(true)
      await updateDatasetSetting({
        datasetId: currentDataset!.id,
        body: {
          name,
          description,
          permission,
          indexing_technique: indexMethod,
        },
      })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      await mutateDatasets()
    }
    catch (e) {
      notify({ type: 'error', message: t('common.actionMsg.modificationFailed') })
    }
    finally {
      setLoading(false)
    }
  }

  useInitialValue<string>(currentDataset?.name ?? '', setName)
  useInitialValue<string>(currentDataset?.description ?? '', setDescription)
  useInitialValue<DataSet['permission'] | undefined>(currentDataset?.permission, setPermission)
  useInitialValue<DataSet['indexing_technique'] | undefined>(currentDataset?.indexing_technique, setIndexMethod)

  return (
    <div className='w-[800px] px-16 py-6'>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.name')}</div>
        </div>
        <input
          className={inputClass}
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.desc')}</div>
        </div>
        <div>
          <textarea
            className={`${inputClass} block mb-2 h-[120px] py-2 resize-none`}
            placeholder={t('datasetSettings.form.descPlaceholder') || ''}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          <a className='flex items-center h-[18px] px-3 text-xs text-gray-500' href="https://docs.dify.ai/advanced/datasets#how-to-write-a-good-dataset-description" target='_blank'>
            <BookOpenIcon className='w-3 h-[18px] mr-1' />
            {t('datasetSettings.form.descWrite')}
          </a>
        </div>
      </div>
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.permissions')}</div>
        </div>
        <div className='w-[480px]'>
          <PermissionsRadio
            value={permission}
            onChange={v => setPermission(v)}
          />
        </div>
      </div>
      <div className='w-full h-0 border-b-[0.5px] border-b-gray-200 my-2' />
      <div className={rowClass}>
        <div className={labelClass}>
          <div>{t('datasetSettings.form.indexMethod')}</div>
        </div>
        <div className='w-[480px]'>
          <IndexMethodRadio
            value={indexMethod}
            onChange={v => setIndexMethod(v)}
          />
        </div>
      </div>
      <div className={rowClass}>
        <div className={labelClass} />
        <div className='w-[480px]'>
          <Button
            className='min-w-24 text-sm'
            type='primary'
            onClick={handleSave}
          >
            {t('datasetSettings.form.save')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default Form
