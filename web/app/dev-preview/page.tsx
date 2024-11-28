'use client'

import { FormattedText } from '../components/datasets/formatted-text/flavours/formatted'
import { NormalSlice } from '../components/datasets/formatted-text/flavours/normal'

export default function Page() {
  return <div className='p-4'>
    <FormattedText>
      <NormalSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <NormalSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <NormalSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <NormalSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <NormalSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
    </FormattedText>
  </div>
}
