import type { FC } from 'react'
import React from 'react'

type Props = {
  loading?: boolean
  className?: string
  children?: React.ReactNode | string
}

const Spinner: FC<Props> = ({ loading = false, children, className }) => {
  return (
    <div
      className={`inline-block text-gray-200 h-4 w-4 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] ${loading ? 'motion-reduce:animate-[spin_1.5s_linear_infinite]' : 'hidden'} ${className ?? ''}`}
      role="status"
    >
      <span
        className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]"
      >Loading...</span>
      {children}
    </div>
  )
}

export default Spinner
