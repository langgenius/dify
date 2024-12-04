import { RiAlertFill } from '@remixicon/react'

type ErrorHandleTipProps = {
  text: string
}
const ErrorHandleTip = ({
  text,
}: ErrorHandleTipProps) => {
  return (
    <div
      className='relative flex p-2 pr-[52px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xs'
    >
      <div
        className='absolute inset-0 opacity-40'
        style={{
          background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)',
        }}
      ></div>
      <RiAlertFill className='shrink-0 mr-1 w-4 h-4 text-text-warning-secondary' />
      <div className='grow system-xs-medium text-text-primary'>
        {text}
      </div>
    </div>
  )
}

export default ErrorHandleTip
