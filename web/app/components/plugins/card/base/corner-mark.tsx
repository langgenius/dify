import { LeftCorner } from '../../../base/icons/src/vender/plugin'

const CornerMark = ({ text }: { text: string }) => {
  return (
    <div className="absolute right-0 top-0 flex pl-[13px]">
      <LeftCorner className="text-background-section" />
      <div className="h-5 rounded-tr-xl bg-background-section pr-2 leading-5 text-text-tertiary system-2xs-medium-uppercase">{text}</div>
    </div>
  )
}

export default CornerMark
