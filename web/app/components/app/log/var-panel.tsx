'use client'
import { useBoolean } from 'ahooks'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
} from '@remixicon/react'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'

type Props = {
  varList: { label: string; value: string }[]
  message_files: string[]
}

const VarPanel: FC<Props> = ({
  varList,
  message_files,
}) => {
  const { t } = useTranslation()
  const [isCollapse, { toggle: toggleCollapse }] = useBoolean(false)
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')

  return (
    <div className='rounded-xl border border-color-indigo-100 bg-indigo-25'>
      <div
        className='flex items-center h-6 pl-2 py-6 space-x-1 cursor-pointer'
        onClick={toggleCollapse}
      >
        {
          isCollapse
            ? <RiArrowRightSLine className='w-3 h-3 text-gray-300' />
            : <RiArrowDownSLine className='w-3 h-3 text-gray-300' />
        }
        <div className='text-sm font-semibold text-indigo-800 uppercase'>{t('appLog.detail.variables')}</div>
      </div>
      {!isCollapse && (
        <div className='px-6 pb-3'>
          {varList.map(({ label, value }, index) => (
            <div key={index} className='flex py-2 leading-[18px] text-[13px]'>
              <div className='shrink-0 w-[128px] flex text-primary-600'>
                <span className='shrink-0 opacity-60'>{'{{'}</span>
                <span className='truncate'>{label}</span>
                <span className='shrink-0 opacity-60'>{'}}'}</span>
              </div>
              <div className='pl-2.5 whitespace-pre-wrap'>{value}</div>
            </div>
          ))}

          {message_files.length > 0 && (
            <div className='mt-1 flex py-2'>
              <div className='shrink-0 w-[128px] leading-[18px] text-[13px] font-medium text-gray-700'>{t('appLog.detail.uploadImages')}</div>
              <div className="flex space-x-2">
                {message_files.map((url, index) => (
                  <div
                    key={index}
                    className="ml-2.5 w-16 h-16 rounded-lg bg-no-repeat bg-cover bg-center cursor-pointer"
                    style={{ backgroundImage: `url(${url})` }}
                    onClick={() => setImagePreviewUrl(url)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {
        imagePreviewUrl && (
          <ImagePreview
            url={imagePreviewUrl}
            onCancel={() => setImagePreviewUrl('')}
          />
        )
      }
    </div>
  )
}
export default React.memo(VarPanel)
