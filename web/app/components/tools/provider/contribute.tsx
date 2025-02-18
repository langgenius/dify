'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiHammerFill,
} from '@remixicon/react'
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
      className="group col-span-1 flex min-h-[160px] cursor-pointer flex-col rounded-xl border-2 border-solid border-transparent bg-white bg-[url('~@/app/components/tools/provider/grid_bg.svg')] bg-cover bg-no-repeat shadow-sm transition-all duration-200 ease-in-out hover:shadow-lg"
    >
      <div className='flex h-[66px] shrink-0 grow-0 items-center gap-3 px-[14px] pb-3 pt-[14px]'>
        <div className='relative flex shrink-0 items-center'>
          <div className='border-primary-100 z-10 flex rounded-[10px] border-[0.5px] bg-white p-3 shadow-md'><RiHammerFill className='text-primary-600 h-4 w-4'/></div>
          <div className='flex -translate-x-2 rounded-[10px] border-[0.5px] border-[#FCE7F6] bg-[#FEF6FB] p-3 shadow-md'><Heart02 className='h-4 w-4 text-[#EE46BC]'/></div>
        </div>
      </div>
      <div className='mb-3 px-[14px] text-[15px] font-semibold leading-5'>
        <div className='text-gradient'>{t('tools.contribute.line1')}</div>
        <div className='text-gradient'>{t('tools.contribute.line2')}</div>
      </div>
      <div className='flex items-center space-x-1 border-t-[0.5px] border-black/5 px-4 py-3 text-[#155EEF]'>
        <BookOpen01 className='h-3 w-3' />
        <div className='grow text-xs font-normal leading-[18px]'>{t('tools.contribute.viewGuide')}</div>
        <ArrowUpRight className='h-3 w-3' />
      </div>
    </a>
  )
}
export default React.memo(Contribute)
