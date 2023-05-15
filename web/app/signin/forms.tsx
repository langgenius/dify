'use client'
import React from 'react'
import { useSearchParams } from 'next/navigation'

import NormalForm from './normalForm'
import OneMoreStep from './oneMoreStep'
import classNames from 'classnames'

const Forms = () => {
  const searchParams = useSearchParams()
  const step = searchParams.get('step')

  const getForm = () => {
    switch (step) {
      case 'next':
        return <OneMoreStep />
      default:
        return <NormalForm />
    }
  }
  return <div className={
    classNames(
      'flex flex-col items-center w-full grow items-center justify-center',
      'px-6',
      'md:px-[108px]',
    )
  }>
    <div className='flex flex-col md:w-[400px]'>
      {getForm()}
    </div>
    
  </div>
}

export default Forms
