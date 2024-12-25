import Button from '@/app/components/base/button'
import { RiArrowLeftLine } from '@remixicon/react'
import TracingPanel from '../tracing-panel'

type AgentResultPanelProps = {
  onBack: () => void
}
const AgentResultPanel = ({
  onBack,
}: AgentResultPanelProps) => {
  return (
    <div className='overflow-y-auto'>
      <div className='flex items-center p-1 pr-3 h-8'>
        <Button
          className='shrink-0 px-[5px]'
          size='small'
          variant='ghost-accent'
          onClick={onBack}
        >
          <RiArrowLeftLine className='mr-1 w-3.5 h-3.5' />
          Back
        </Button>
        <div className='shrink-0 mx-0.5 system-xs-regular text-divider-deep'>/</div>
        <div className='grow px-[5px] system-xs-medium-uppercase'>
          Agent strategy
        </div>
        <Button
          className='px-[5px]'
          size='small'
          variant='ghost-accent'
          onClick={onBack}
        >
          close
        </Button>
      </div>
      <TracingPanel
        list={[]}
      />
    </div>
  )
}

export default AgentResultPanel
