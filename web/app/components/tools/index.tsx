'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Button from '../base/button'
import type { Collection } from './types'
import { LOC } from './types'
import ToolNavList from './tool-nav-list'
import TabSlider from '@/app/components/base/tab-slider'
type Props = {
  loc: LOC
}

const Tools: FC<Props> = ({
  loc,
}) => {
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools

  const [currCollection, setCurrCollection] = React.useState<Collection | null>(null)
  const [activeTab, setActiveTab] = React.useState<string>('/tools/third-part')

  const options = [
    { value: '/tools/third-part', text: t('tools.type.thirdParty').toUpperCase() },
    { value: '/tools/custom', text: t('tools.type.custom').toUpperCase() },
  ]

  return (
    <div className='flex h-full'>
      {/* sidebar */}
      <div className={cn(isInToolsPage && 'px-4', 'flex flex-col sm:w-56 w-16 overflow-y-auto shrink-0 mobile:h-screen')}>
        <Button className='mt-6'>add ool</Button>
        <TabSlider
          value={activeTab}
          onChange={setActiveTab}
          options={options}
        />
        <div>search</div>

        <ToolNavList list={[]} onChosen={setCurrCollection} />
        {loc === LOC.tools && (
          <div>Star</div>
        )}
      </div>

      {/* tools */}
      <div className='grow h-full overflow-hidden p-2'>
        <div className='h-full border-l border-gray-200 bg-white rounded-2xl'>
          content
        </div>
      </div>
    </div>
  )
}
export default React.memo(Tools)
