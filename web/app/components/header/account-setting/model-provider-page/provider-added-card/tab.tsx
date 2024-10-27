import type { FC } from 'react'

type TabProps = {
  active: string
  onSelect: (active: string) => void
}
const Tab: FC<TabProps> = ({
  active,
  onSelect,
}) => {
  const tabs = [
    {
      key: 'all',
      text: 'All',
    },
    {
      key: 'added',
      text: 'Added',
    },
    {
      key: 'build-in',
      text: 'Build-in',
    },
  ]
  return (
    <div className='flex items-center'>
      {
        tabs.map(tab => (
          <div
            key={tab.key}
            className={`
              flex items-center mr-1 px-[5px] h-[18px] rounded-md text-xs cursor-pointer
              ${active === tab.key ? 'bg-gray-200 font-medium text-gray-900' : 'text-gray-500 font-normal'}
            `}
            onClick={() => onSelect(tab.key)}
          >
            {tab.text}
          </div>
        ))
      }
    </div>
  )
}

export default Tab
