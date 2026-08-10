'use client'
import * as React from 'react'
import ChangePasswordForm from '@/app/forgot-password/ChangePasswordForm'
import { useSearchParams } from '@/next/navigation'
import ForgotPasswordForm from './ForgotPasswordForm'

const ForgotPassword = () => {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  return token ? <ChangePasswordForm /> : <ForgotPasswordForm />
}

export default ForgotPassword
