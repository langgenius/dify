'use client'
import { useBoolean } from 'ahooks'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
} from '@remixicon/react'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import ImagePreview from '@/app/components/base/image-uploader/image-preview'
import cn from '@/utils/classnames'

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
    <div className='rounded-[10px] border border-divider-subtle bg-chat-bubble-bg'>
      <div
        className={cn('flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-divider-subtle text-text-secondary cursor-pointer', isCollapse && 'pb-2.5 border-0')}
        onClick={toggleCollapse}
      >
        <Variable02 className='w-4 h-4' />
        <div className='grow system-md-medium'>{t('appLog.detail.variables')}</div>
        {
          isCollapse
            ? <RiArrowRightSLine className='w-4 h-4' />
            : <RiArrowDownSLine className='w-4 h-4' />
        }
      </div>
      {!isCollapse && (
        <div className='p-3 flex flex-col gap-2'>
          {varList.map(({ label, value }, index) => (
            <div key={index} className='flex py-2 system-xs-medium'>
              <div className='shrink-0 w-[128px] flex text-text-accent'>
                <span className='shrink-0 opacity-60'>{'{{'}</span>
                <span className='truncate'>{label}</span>
                <span className='shrink-0 opacity-60'>{'}}'}</span>
              </div>
              <div className='pl-2.5 whitespace-pre-wrap text-text-secondary'>{value}</div>
            </div>
          ))}

          {message_files.length > 0 && (
            <div className='mt-1 flex py-2'>
              <div className='shrink-0 w-[128px] system-xs-medium text-text-tertiary'>{t('appLog.detail.uploadImages')}</div>
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
            title={imagePreviewUrl}
            onCancel={() => setImagePreviewUrl('')}
          />
        )
      }
    </div>
  )
}
export default React.memo(VarPanel)
