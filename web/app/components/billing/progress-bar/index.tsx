type ProgressBarProps = {
  percent: number
  color: string
}
const ProgressBar = ({
  percent = 0,
  color = '#2970FF',
}: ProgressBarProps) => {
  return (
    <div className='overflow-hidden rounded-[4px] bg-[#F2F4F7]'>
      <div
        className='h-2 rounded-[4px]'
        style={{
          width: `${Math.min(percent, 100)}%`,
          backgroundColor: color,
        }}
      />
    </div>
  )
}

export default ProgressBar
