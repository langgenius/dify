'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { ToolsActive } from '@/app/components/base/icons/src/public/header-nav/tools'
import { Heart02 } from '@/app/components/base/icons/src/vender/solid/education'
import { BookOpen01 } from '@/app/components/base/icons/src/vender/line/education'
import { ArrowUpRight } from '@/app/components/base/icons/src/vender/line/arrows'

const Contribute: FC = () => {
  const { t } = useTranslation()

  return (
    <a
      href='https://github.com/langgenius/dify/blob/main/api/core/tools/README.md'
      target='_blank'
      rel='noopener noreferrer'
      className="group flex col-span-1 bg-white bg-cover bg-no-repeat bg-[url('~@/app/components/tools/provider/grid_bg.svg')] border-2 border-solid border-transparent rounded-xl shadow-sm min-h-[160px] flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg"
    >
      <div className='flex pt-[14px] px-[14px] pb-3 h-[66px] items-center gap-3 grow-0 shrink-0'>
        <div className='relative shrink-0 flex items-center'>
          <div className='z-10 flex p-3 rounded-[10px] bg-white border-[0.5px] border-primary-100 shadow-md'><ToolsActive className='w-4 h-4 text-primary-600'/></div>
          <div className='-translate-x-2 flex p-3 rounded-[10px] bg-[#FEF6FB] border-[0.5px] border-[#FCE7F6] shadow-md'><Heart02 className='w-4 h-4 text-[#EE46BC]'/></div>
        </div>
      </div>
      <div className='mb-3 px-[14px] text-[15px] leading-5 font-semibold'>
        <div className='text-gradient'>{t('tools.contribute.line1')}</div>
        <div className='text-gradient'>{t('tools.contribute.line2')}</div>
      </div>
      <div className='px-4 py-3 border-t-[0.5px] border-black/5 flex items-center space-x-1 text-[#155EEF]'>
        <BookOpen01 className='w-3 h-3' />
        <div className='grow leading-[18px] text-xs font-normal'>{t('tools.contribute.viewGuide')}</div>
        <ArrowUpRight className='w-3 h-3' />
      </div>
    </a>
  )
}
export default React.memo(Contribute)
