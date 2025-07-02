import React from 'react'
import Item from './item'

type TabProps = {
  activeTab: string
  handleTabChange: (tab: string) => void
  options: { value: string; label: string; }[]
}

const Tab = ({
  activeTab,
  handleTabChange,
  options,
}: TabProps) => {
  return (
    <div className='px-16 pt-2'>
      <div className='relative flex h-10 items-center gap-x-6'>
        {options.map((option, index) => (
          <Item
            key={index}
            option={option}
            isSelected={activeTab === option.value}
            onClick={handleTabChange}
          />
        ))}
        <div className='absolute bottom-0 left-0 h-px w-full bg-divider-subtle' />
      </div>
    </div>
  )
}

export default React.memo(Tab)
