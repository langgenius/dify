import { useStore } from '../store'
import type { HelpLinePosition } from './types'

const HelpLineBase = ({
  top,
  right,
  bottom,
  left,
}: HelpLinePosition) => {
  return (
    <div
      className='absolute w-[1px] bg-primary-300 z-[9]'
      style={{ top, right, bottom, left }}
    />
  )
}

const HelpLine = () => {
  const helpLine = useStore(state => state.helpLine)

  return (
    <>
      {
        helpLine?.bottom && (
          <HelpLineBase {...helpLine} />
        )
      }
      {
        helpLine?.right && (
          <HelpLineBase {...helpLine} />
        )
      }
    </>
  )
}

export default HelpLine
