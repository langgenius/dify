'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deletePromptTemplate, fetchPromptTemplates } from '@/service/prompt-template'
import type { PromptTemplate } from '@/models/prompt-template'
import Button from '@/app/components/base/button'
import NewTemplateModal from './NewTemplateModal'
import { TrashIcon } from '@heroicons/react/24/outline'

const Container = () => {
  const router = useRouter()
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [showNewModal, setShowNewModal] = useState(false)

  const fetchTemplates = useCallback(() => {
    fetchPromptTemplates().then((res) => {
      // res may be an array or an object with a data property
      const templateList = Array.isArray(res) ? res : res.data
      setTemplates(templateList || [])
    })
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleSuccess = () => {
    fetchTemplates()
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation() // Prevent row click event
    // TODO: Replace with custom modal confirmation
    // if (window.confirm('Are you sure you want to delete this template?')) {
    console.log('TODO: Show custom confirm modal for delete')
    const userConfirmed = true // 模拟用户确认，后续用自定义弹窗替换
    if (userConfirmed) {
      try {
        await deletePromptTemplate(id)
        fetchTemplates()
      }
      catch (e: any) {
        // TODO: Replace with custom error notification
        // alert(`Failed to delete template: ${e.message}`)
        console.error(`Failed to delete template: ${e.message}`)
      }
    }
  }

  const handleRowClick = (id: string) => {
    router.push(`/prompt-templates/${id}`)
  }

  return (
    <>
      <div className="p-4 sm:p-6 md:p-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Prompt Templates</h1>
          <Button variant="primary" onClick={() => router.push('/prompt-templates/new')}>Create Template</Button>
        </div>
        <div className="rounded-lg bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Name</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Model</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Created At</th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {templates.map(template => (
                <tr key={template.id} onClick={() => handleRowClick(template.id)} className="cursor-pointer hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{template.name}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{template.model_settings?.model_name}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{new Date(template.created_at).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium">
                    <button onClick={e => handleDelete(e, template.id)} className="p-1 text-red-600 hover:text-red-900">
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showNewModal && (
        <NewTemplateModal
          isShow={showNewModal}
          onClose={() => setShowNewModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  )
}

export default Container
