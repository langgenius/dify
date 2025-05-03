'use client'
import HeaderEffect from './header-effect'
import Header from './header'
import CreateOptions from './create-options'

const CreateFromPipeline = () => {
  return (
    <div
      className='relative flex flex-col rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
      style={{ height: 'calc(100vh - 56px)' }}
    >
      <HeaderEffect />
      <Header />
      <CreateOptions />
    </div>
  )
}

export default CreateFromPipeline
