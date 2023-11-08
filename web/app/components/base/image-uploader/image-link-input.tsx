import type {} from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

const ImageLinkInput = () => {
  const { t } = useTranslation()
  const [imageLink, setImageLink] = useState('')

  return (
    <div className='flex items-center pl-1.5 pr-1 h-8 border border-gray-200 bg-white shadow-xs rounded-lg'>
      <input
        className='grow mr-0.5 px-1 h-[18px] text-[13px] outline-none appearance-none'
        value={imageLink}
        onChange={e => setImageLink(e.target.value)}
        placeholder={t('common.imageUploader.pasteImageLinkInputPlaceholder') || ''}
      />
      <Button
        type='primary'
        className='!h-6 text-xs font-medium'
        disabled={!imageLink}
      >
        {t('common.operation.ok')}
      </Button>
    </div>
  )
}

export default ImageLinkInput
