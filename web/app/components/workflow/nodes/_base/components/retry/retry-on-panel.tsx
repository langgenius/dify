import Tooltip from '@/app/components/base/tooltip'
import Switch from '@/app/components/base/switch'
import Slider from '@/app/components/base/slider'
import Input from '@/app/components/base/input'
import type { Node } from '@/app/components/workflow/types'
import Split from '@/app/components/workflow/nodes/_base/components/split'

type RetryOnPanelProps = Pick<Node, 'id' | 'data'>
const RetryOnPanel = (props: RetryOnPanelProps) => {
  return (
    <>
      <div className='pt-2'>
        <div className='flex items-center justify-between px-4 py-2 h-10'>
          <div className='flex items-center'>
            <div className='mr-0.5 system-sm-semibold-uppercase text-text-secondary'>retry on failure</div>
            <Tooltip
              popupContent='Retry the node when it fails'
            />
          </div>
          <Switch />
        </div>
        <div className='px-4 pb-2'>
          <div className='flex items-center mb-1 w-full'>
            <div className='grow mr-2 system-xs-medium-uppercase'>Retry count</div>
            <Slider
              className='mr-3 w-[108px]'
              value={3}
              onChange={() => {}}
              min={1}
              max={10}
            />
            <Input
              type='number'
              wrapperClassName='w-[80px]'
            />
          </div>
          <div className='flex items-center'>
            <div className='grow mr-2 system-xs-medium-uppercase'>Retry interval</div>
            <Slider
              className='mr-3 w-[108px]'
              value={1000}
              onChange={() => {}}
              min={100}
              max={5000}
            />
            <Input
              type='number'
              wrapperClassName='w-[80px]'
            />
          </div>
        </div>
      </div>
      <Split className='mx-4 mt-2' />
    </>
  )
}

export default RetryOnPanel
