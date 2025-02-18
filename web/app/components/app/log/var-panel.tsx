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
    <div className='border-divider-subtle bg-chat-bubble-bg rounded-[10px] border'>
      <div
        className={cn('border-divider-subtle text-text-secondary flex cursor-pointer items-center gap-1 border-b px-3 pb-2 pt-2.5', isCollapse && 'border-0 pb-2.5')}
        onClick={toggleCollapse}
      >
        <Variable02 className='h-4 w-4' />
        <div className='system-md-medium grow'>{t('appLog.detail.variables')}</div>
        {
          isCollapse
            ? <RiArrowRightSLine className='h-4 w-4' />
            : <RiArrowDownSLine className='h-4 w-4' />
        }
      </div>
      {!isCollapse && (
        <div className='flex max-h-[500px] flex-col gap-2 overflow-y-auto p-3'>
          {varList.map(({ label, value }, index) => (
            <div key={index} className='system-xs-medium flex py-2'>
              <div className='text-text-accent flex w-[128px] shrink-0'>
                <span className='shrink-0 opacity-60'>{'{{'}</span>
                <span className='truncate'>{label}</span>
                <span className='shrink-0 opacity-60'>{'}}'}</span>
              </div>
              <div className='text-text-secondary whitespace-pre-wrap pl-2.5'>{value}</div>
            </div>
          ))}

          {message_files.length > 0 && (
            <div className='mt-1 flex py-2'>
              <div className='system-xs-medium text-text-tertiary w-[128px] shrink-0'>{t('appLog.detail.uploadImages')}</div>
              <div className="flex space-x-2">
                {message_files.map((url, index) => (
                  <div
                    key={index}
                    className="ml-2.5 h-16 w-16 cursor-pointer rounded-lg bg-cover bg-center bg-no-repeat"
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
