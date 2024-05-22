'use client'
// import { useMemo } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useMount } from 'ahooks'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import { useStore as useLabelStore } from '@/app/components/tools/labels/store'
import { fetchLabelList } from '@/service/tools'

type Props = {
  value: string
  onSelect: (type: string) => void
}

const Category = ({
  value,
  onSelect,
}: Props) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const labelList = useLabelStore(s => s.labelList)
  const setLabelList = useLabelStore(s => s.setLabelList)

  useMount(() => {
    fetchLabelList().then((res) => {
      setLabelList(res)
    })
  })

  return (
    <div className='mb-3'>
      <div className='px-3 py-0.5 text-gray-500 text-xs leading-[18px] font-medium'>{t('tools.addToolModal.category').toLocaleUpperCase()}</div>
      <div className={cn('mb-0.5 p-1 pl-3 flex items-center cursor-pointer text-gray-700 text-sm leading-5 rounded-lg hover:bg-white', value === '' && '!bg-white !text-primary-600 font-medium')} onClick={() => onSelect('')}>{t('tools.type.all')}</div>
      {labelList.map(label => (
        <div key={label.name} title={label.label[language]} className={cn('mb-0.5 p-1 pl-3 flex items-center cursor-pointer text-gray-700 text-sm leading-5 rounded-lg hover:bg-white truncate overflow-hidden', value === label.name && '!bg-white !text-primary-600 font-medium')} onClick={() => onSelect(label.name)}>{label.label[language]}</div>
      ))}
    </div>
  )
}
export default Category
