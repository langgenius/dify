'use client'

import { AppProgressBar as ProgressBar } from 'next-nprogress-bar'

const Topbar = () => {
  return (
    <>
      <ProgressBar
        height='2px'
        color="#c84349FF"
        options={{ showSpinner: false }}
        shallowRouting />
    </>)
}

export default Topbar
