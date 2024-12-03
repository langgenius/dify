'use client'

import { FormattedText } from '../components/datasets/formatted-text/formatted'
import { PreviewSlice } from '../components/datasets/formatted-text/flavours/preview-slice'
import { PreviewContainer } from '../components/datasets/preview/container'
import { PreviewHeader } from '../components/datasets/preview/header'
import FileIcon from '../components/base/file-icon'
import { ChevronDown } from '../components/base/icons/src/vender/solid/arrows'
import Badge from '../components/base/badge'
import { DividerWithLabel } from '../components/base/divider/with-label'

export default function Page() {
  return <div className='p-4'>
    <PreviewContainer header={
      <PreviewHeader title='Preview'>
        <div className='flex items-center'>
          <FileIcon type='pdf' className='size-4' />
          <p
            className='text-text-primary text-sm font-semibold mx-1'
          >EOS R3 Tech Sheet.pdf</p>
          <ChevronDown className='size-[18px]' />
          <Badge text='276 Estimated chunks' className='ml-1' />
        </div>
      </PreviewHeader>
    }>
      <FormattedText>
        <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
        <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
        <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
        <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
        <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      </FormattedText>
      <DividerWithLabel label='Display previews of up to 10 paragraphs' />
    </PreviewContainer>
  </div>
}
