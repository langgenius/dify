'use client'
import React from 'react'
import classNames from 'classnames'
import { useSearchParams } from 'next/navigation'
import Header from '../signin/_header'
import style from '../signin/page.module.css'
import ForgotPasswordForm from './ForgotPasswordForm'
import ChangePasswordForm from '@/app/forgot-password/ChangePasswordForm'

const ForgotPassword = () => {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  return (
    <div className={classNames(
      style.background,
      'flex w-full min-h-screen',
      'p-4 lg:p-8',
      'gap-x-20',
      'justify-center lg:justify-start',
    )}>
      <div className={
        classNames(
          'flex w-full flex-col bg-white shadow rounded-2xl shrink-0',
          'md:w-[608px] space-between',
        )
      }>
        <Header />
        {token ? <ChangePasswordForm /> : <ForgotPasswordForm />}
        <div className='px-8 py-6 text-sm font-normal text-gray-500'>
          © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
        </div>
      </div>
    </div>
  )
}

export default ForgotPassword
