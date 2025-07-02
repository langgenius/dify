'use client'
import Header from './header'
import CreateOptions from './create-options'
import List from './list'
import Effect from '../../base/effect'

const CreateFromPipeline = () => {
  return (
    <div
      className='relative flex h-[calc(100vh-56px)] flex-col rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
    >
      <Effect className='left-8 top-[-34px] opacity-20' />
      <Header />
      <CreateOptions />
      <List />
    </div>
  )
}

export default CreateFromPipeline
