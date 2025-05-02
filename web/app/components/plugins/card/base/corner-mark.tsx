import { LeftCorner } from '../../../base/icons/src/vender/plugin'

const CornerMark = ({ text }: { text: string }) => {
  return (
    <div className='absolute top-0 right-0 flex pl-[13px] '>
      <LeftCorner className="text-background-section" />
      <div className="h-5 leading-5 rounded-tr-xl pr-2 bg-background-section text-text-tertiary system-2xs-medium-uppercase">{text}</div>
    </div>
  )
}

export default CornerMark
