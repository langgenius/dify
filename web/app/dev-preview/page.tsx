'use client'

import { FormattedText } from '../components/datasets/formatted-text/formatted'
import { PreviewSlice } from '../components/datasets/formatted-text/flavours/preview-slice'
import { EditSlice } from '../components/datasets/formatted-text/flavours/edit-slice'

export default function Page() {
  return <div className='p-4'>
    <FormattedText>
      <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
      <PreviewSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' tooltip={'Child-chunk-2 · 268 Characters'} />
    </FormattedText>

    <div className='mt-12 flex flex-col gap-2'>
      <EditSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' onDelete={function (): void {
        console.log('onDelete')
      } } />
      <EditSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' onDelete={function (): void {
        console.log('onDelete')
      } } />
      <EditSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' onDelete={function (): void {
        console.log('onDelete')
      } } />
      <EditSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' onDelete={function (): void {
        console.log('onDelete')
      } } />
      <EditSlice label='C-1' text='lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' onDelete={function (): void {
        console.log('onDelete')
      } } />
    </div>
  </div>
}
