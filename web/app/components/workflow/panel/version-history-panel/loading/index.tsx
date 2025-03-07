import random from 'lodash-es/random'
import Item from './item'

const Loading = () => {
  const itemConfig = Array.from({ length: 8 }).map((_, index) => {
    return {
      isFirst: index === 0,
      isLast: index === 7,
      titleWidth: `w-[${random(50, 80)}%]`,
      releaseNotesWidth: `w-[${random(50, 80)}%]`,
    }
  })

  return <div className='relative w-full h-[420px] overflow-y-hidden'>
    <div className='absolute top-0 left-0 w-full h-full bg-dataset-chunk-list-mask-bg' />
    {itemConfig.map((config, index) => <Item key={index} {...config} />)}
  </div>
}

export default Loading
