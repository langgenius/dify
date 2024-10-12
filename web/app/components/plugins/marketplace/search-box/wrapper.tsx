'use client'

import SearchBox from '.'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'

const Wrapper = () => {
  const scrollDisabled = usePluginPageContext(v => v.scrollDisabled)

  return (
    <SearchBox widthShouldChange={scrollDisabled} />
  )
}

export default Wrapper
