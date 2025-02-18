'use client'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useMount } from 'ahooks'
import cn from '@/utils/classnames'
import { Apps02 } from '@/app/components/base/icons/src/vender/line/others'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import { useStore as useLabelStore } from '@/app/components/tools/labels/store'
import { fetchLabelList } from '@/service/tools'

type Props = {
  value: string
  onSelect: (type: string) => void
}

const Icon = ({ svgString, active }: { svgString: string; active: boolean }) => {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const SVGParser = (svg: string) => {
    if (!svg)
      return null
    const parser = new DOMParser()
    const doc = parser.parseFromString(svg, 'image/svg+xml')
    return doc.documentElement
  }
  useMount(() => {
    const svgElement = SVGParser(svgString)
    if (svgRef.current && svgElement)
      svgRef.current.appendChild(svgElement)
  })
  return <svg className={cn('h-4 w-4 text-gray-700', active && '!text-primary-600')} ref={svgRef} />
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
      <div className='px-3 py-0.5 text-xs font-medium leading-[18px] text-gray-500'>{t('tools.addToolModal.category').toLocaleUpperCase()}</div>
      <div className={cn('mb-0.5 flex cursor-pointer items-center rounded-lg p-1 pl-3 text-sm leading-5 text-gray-700 hover:bg-white', value === '' && '!text-primary-600 !bg-white font-medium')} onClick={() => onSelect('')}>
        <Apps02 className='mr-2 h-4 w-4 shrink-0' />
        {t('tools.type.all')}
      </div>
      {labelList.map(label => (
        <div key={label.name} title={label.label[language]} className={cn('mb-0.5 flex cursor-pointer items-center overflow-hidden truncate rounded-lg p-1 pl-3 text-sm leading-5 text-gray-700 hover:bg-white', value === label.name && '!text-primary-600 !bg-white font-medium')} onClick={() => onSelect(label.name)}>
          <div className='mr-2 h-4 w-4 shrink-0'>
            <Icon active={value === label.name} svgString={label.icon} />
          </div>
          {label.label[language]}
        </div>
      ))}
    </div>
  )
}
export default Category
