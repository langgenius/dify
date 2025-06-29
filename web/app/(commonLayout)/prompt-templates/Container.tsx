'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { fetchPromptTemplates, deletePromptTemplate } from '@/service/prompt-template'
import type { PromptTemplate } from '@/models/prompt-template'
import Button from '@/app/components/base/button'
import NewTemplateModal from './NewTemplateModal'
import { TrashIcon } from '@heroicons/react/24/outline'

const Container = () => {
  const router = useRouter()
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [showNewModal, setShowNewModal] = useState(false)

  const fetchTemplates = useCallback(() => {
    fetchPromptTemplates().then(res => {
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
    if (window.confirm('Are you sure you want to delete this template?')) {
      try {
        await deletePromptTemplate(id)
        fetchTemplates()
      } catch (e: any) {
        alert(`Failed to delete template: ${e.message}`)
      }
    }
  }

  const handleRowClick = (id: string) => {
    router.push(`/prompt-templates/${id}`)
  }

  return (
    <>
      <div className="p-4 sm:p-6 md:p-8">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-semibold">Prompt Templates</h1>
          <Button variant="primary" onClick={() => router.push('/prompt-templates/new')}>Create Template</Button>
        </div>
        <div className="bg-white shadow-sm rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                <th scope="col" className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {templates.map((template) => (
                <tr key={template.id} onClick={() => handleRowClick(template.id)} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{template.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{template.model_settings?.model_name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(template.created_at).toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button onClick={(e) => handleDelete(e, template.id)} className="text-red-600 hover:text-red-900 p-1">
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