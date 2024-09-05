import type { FC } from 'react'
import { useRef } from 'react'
import { t } from 'i18next'
import { createPortal } from 'react-dom'
import { RiCloseLine, RiExternalLinkLine } from '@remixicon/react'
import Tooltip from '@/app/components/base/tooltip'
import { randomString } from '@/utils'

type ImagePreviewProps = {
  url: string
  title: string
  onCancel: () => void
}
const ImagePreview: FC<ImagePreviewProps> = ({
  url,
  title,
  onCancel,
}) => {
  const selector = useRef(`copy-tooltip-${randomString(4)}`)

  const openInNewTab = () => {
    // Open in a new window, considering the case when the page is inside an iframe
    if (url.startsWith('http')) {
      window.open(url, '_blank')
    }
    else if (url.startsWith('data:image')) {
      // Base64 image
      const win = window.open()
      win?.document.write(`<img src="${url}" alt="${title}" />`)
    }
    else {
      console.error('Unable to open image', url)
    }
  }

  return createPortal(
    <div className='fixed inset-0 p-8 flex items-center justify-center bg-black/80 z-[1000]' onClick={e => e.stopPropagation()}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={title}
        src={url}
        className='max-w-full max-h-full'
      />
      <div
        className='absolute top-6 right-6 flex items-center justify-center w-8 h-8 bg-white/8 rounded-lg backdrop-blur-[2px] cursor-pointer'
        onClick={onCancel}
      >
        <RiCloseLine className='w-4 h-4 text-white' />
      </div>
      <Tooltip
        selector={selector.current}
        content={(t('common.operation.openInNewTab') ?? 'Open in new tab')}
        className='z-10'
      >
        <div
          className='absolute top-6 right-16 flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer'
          onClick={openInNewTab}
        >
          <RiExternalLinkLine className='w-4 h-4 text-white' />
        </div>
      </Tooltip>
    </div>,
    document.body,
  )
}

export default ImagePreview
