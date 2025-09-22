'use client'
import Header from './header'
import List from './list'
import Effect from '../../base/effect'
import Footer from './footer'

const CreateFromPipeline = () => {
  return (
    <div
      className='relative flex h-[calc(100vh-56px)] flex-col overflow-hidden rounded-t-2xl border-t border-effects-highlight bg-background-default-subtle'
    >
      <Effect className='left-8 top-[-34px] opacity-20' />
      <Header />
      <List />
      <Footer />
    </div>
  )
}

export default CreateFromPipeline
