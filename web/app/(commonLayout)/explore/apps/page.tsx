import React, { FC } from 'react'
import AppCard from '@/app/components/explore/app-card'

export interface IAppsProps { }
const list = [
  {
    id: 1,
    name: 'Story Bot',
    mode: 'chat',
    model_config: {
      pre_prompt: 'I need you to play the role of a storyteller, and generate creative and vivid short stories based on the keywords I provide.',
    }
  },
  {
    id: 2,
    name: 'Code Translate',
    mode: 'completion',
  },
]
const Apps: FC<IAppsProps> = ({ }) => {
  return (
    <div className='h-full flex flex-col'>
      <div className='shrink-0 pt-6 px-12'>
        <div className='mb-1 text-primary-600 text-xl font-semibold'>Explore Apps by Dify</div>
        <div className='text-gray-500 text-sm'>Use these template apps instantly or customize your own apps based on the templates.</div>
      </div>
      <div className='grow-1 flex flex-col overflow-auto bg-gray-100 shrink-0 grow'>
        <nav className='grid content-start grid-cols-1 gap-4 px-12 pt-8 sm:grid-cols-2 lg:grid-cols-4 grow shrink-0'>
          {list.map(item => (
            <AppCard key={item.id} app={item as any} />
          ))}
        </nav>
      </div>
    </div>
  )
}
export default React.memo(Apps)
