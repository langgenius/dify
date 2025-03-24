type ProgressBarProps = {
  percent: number
}
const ProgressBar = ({
  percent = 0,
}: ProgressBarProps) => {
  return (
    <div className='flex items-center'>
      <div className='mr-2 w-[100px] rounded-lg bg-gray-100'>
        <div
          className='h-1 rounded-lg bg-[#2970FF]'
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className='text-xs font-medium text-gray-500'>{percent}%</div>
    </div>
  )
}

export default ProgressBar
