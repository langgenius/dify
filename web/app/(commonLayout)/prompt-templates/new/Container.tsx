'use client'
import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import Form from '../Form'
import { createPromptTemplate } from '@/service/prompt-template'
import Toast from '@/app/components/base/toast'

const Container = () => {
  const { t } = useTranslation()
  const router = useRouter()

  const handleSave = async (data: any) => {
    try {
      await createPromptTemplate(data)
      Toast.notify({
        type: 'success',
        message: t('common.api.saved'),
      })
      router.push('/prompt-templates')
    } catch (e: any) {
      Toast.notify({
        type: 'error',
        message: e.message || 'Failed to create template',
      })
    }
  }

  const handleCancel = () => {
    router.back()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="grow overflow-y-auto">
        <Form
          type="create"
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}

export default Container 