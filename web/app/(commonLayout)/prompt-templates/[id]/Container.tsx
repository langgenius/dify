'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { getPromptTemplate, updatePromptTemplate } from '@/service/prompt-template'
import type { PromptTemplate } from '@/models/prompt-template'
import Form from '../Form'
import Toast from '@/app/components/base/toast'

const Container = ({ id }: { id: string }) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [template, setTemplate] = useState<PromptTemplate | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const data = await getPromptTemplate(id)
        setTemplate(data)
      } catch (e) {
        // handle error
        console.error(e)
      } finally {
        setLoading(false)
      }
    })()
  }, [id])
  
  const handleSave = async (data: any) => {
    try {
      await updatePromptTemplate(id, data)
      Toast.notify({
        type: 'success',
        message: t('common.api.saved'),
      })
    } catch(e: any) {
      Toast.notify({
        type: 'error',
        message: e.message || 'Failed to save template',
      })
    }
  }

  if (loading) {
    return <div>Loading...</div>
  }

  if (!template) {
    // TODO: better error/not found display
    return <div>Template not found</div>
  }

  const handleCancel = () => {
    router.back()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="grow overflow-y-auto">
        <Form
          type="edit"
          template={template}
          templateId={id}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}

export default Container 