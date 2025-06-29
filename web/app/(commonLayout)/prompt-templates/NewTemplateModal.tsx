'use client'

import { useState } from 'react'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { createPromptTemplate } from '@/service/prompt-template'
import type { PromptTemplateRequest } from '@/models/prompt-template'

type NewTemplateModalProps = {
  isShow: boolean
  onClose: () => void
  onSuccess: () => void
}

const NewTemplateModal = ({ isShow, onClose, onSuccess }: NewTemplateModalProps) => {
  const [name, setName] = useState('')
  const [promptContent, setPromptContent] = useState('')
  const [modelName, setModelName] = useState('gpt-3.5-turbo')
  const [modelParameters, setModelParameters] = useState({ temperature: 0.7, max_tokens: 256 })

  const handleCreate = async () => {
    if (!name.trim() || !promptContent.trim()) {
      // Basic validation
      // alert('Name and Prompt Content cannot be empty.')
      console.error('Name and Prompt Content cannot be empty.') // TODO: Replace with custom notification
      return
    }

    const data: PromptTemplateRequest = {
      name,
      prompt_content: promptContent,
      model_settings: {
        model_name: modelName,
        model_parameters: modelParameters,
      },
    }

    try {
      await createPromptTemplate(data)
      onSuccess()
      onClose()
    }
    catch (e: any) {
      // alert(`Failed to create template: ${e.message}`)
      console.error(`Failed to create template: ${e.message}`) // TODO: Replace with custom notification
    }
  }

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      title="Create New Prompt Template"
      className="!w-[600px]"
    >
      <div className="p-6">
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">Template Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="e.g. My Awesome Prompt"
          />
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-gray-700">Prompt Content</label>
          <textarea
            value={promptContent}
            onChange={e => setPromptContent(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="Write your prompt here. Use {{variable_name}} for variables."
          />
        </div>

        {/* Simplified Model Settings for now */}
        <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-gray-700">Model (simplified)</label>
            <p className='text-sm text-gray-500'>Using default model settings for now.</p>
            <p className='text-xs text-gray-400'>Model: {modelName}</p>
            <p className='text-xs text-gray-400'>Params: {JSON.stringify(modelParameters)}</p>
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleCreate}>Create</Button>
        </div>
      </div>
    </Modal>
  )
}

export default NewTemplateModal
