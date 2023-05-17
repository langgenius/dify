'use client'
import React, { FC, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Category from '@/app/components/explore/category'
import AppCard from '@/app/components/explore/app-card'
import { fetchAppList } from '@/service/explore'

import s from './style.module.css'

const mockList = [
  {
    id: 1,
    name: 'Story Bot',
    mode: 'chat',
    category: 'music',
    model_config: {
      pre_prompt: 'I need you to play the role of a storyteller, and generate creative and vivid short stories based on the keywords I provide.',
    }
  },
  {
    id: 2,
    name: 'Code Translate',
    mode: 'completion',
    category: 'news',
  },
  {
    id: 3,
    name: 'Code Translate',
    mode: 'completion',
    category: 'news',
  },
  {
    id: 4,
    name: 'Code Translate',
    mode: 'completion',
    category: 'news',
  },
  {
    id: 5,
    name: 'Code Translate',
    mode: 'completion',
    category: 'news',
  },
]

const mockCategories = ['music', 'news']

const isMock = true
const Apps: FC = ({ }) => {
  const { t } = useTranslation()

  const [currCategory, setCurrCategory] = React.useState('')
  const [allList, setAllList] = React.useState(isMock ? mockList : [])
  const currList = (() => {
    if(currCategory === '') return allList
    return allList.filter(item => item.category === currCategory)
  })()
  const [categories, setCategories] = React.useState(isMock ? mockCategories : [])
  useEffect(() => {
    if(!isMock) {
      (async () => {
        const {categories, recommended_apps}:any = await fetchAppList()
        setCategories(categories)
        setAllList(recommended_apps)
      })()
    }
  }, [])
  return (
    <div className='h-full flex flex-col'>
      <div className='shrink-0 pt-6 px-12'>
        <div className='mb-1 text-primary-600 text-xl font-semibold'>{t('explore.apps.title')}</div>
        <div className='text-gray-500 text-sm'>{t('explore.apps.description')}</div>
      </div>
      <Category
        className='mt-6 px-12'
        list={categories}
        value={currCategory}
        onChange={setCurrCategory}
      />
      <div className='flex flex-col overflow-auto bg-gray-100 shrink-0 grow'>
        <nav className={`${s.appList} grid content-start grid-cols-1 gap-4 px-12 pt-6 md:grid-cols-2 grow shrink-0`}>
          {currList.map(item => (
            <AppCard key={item.id} app={item as any} />
          ))}
        </nav>
      </div>
    </div>
  )
}

export default React.memo(Apps)
