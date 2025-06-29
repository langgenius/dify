'use client'
import React, { useState } from 'react'
import type { PromptTemplate, PromptTemplateRequest } from '@/models/prompt-template'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import Button from '@/app/components/base/button'
import TagInput from '@/app/components/base/tag-input'
import Select from '@/app/components/base/select'
import { format as formatDate } from 'date-fns'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Trigger from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal/trigger'

type FormProps = {
  type: 'create' | 'edit'
  template?: PromptTemplate
  templateId?: string
  onSave: (data: PromptTemplateRequest) => void
  onCancel: () => void
}

const Form = ({ type, template, templateId, onSave, onCancel }: FormProps) => {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    tags: template?.tags || [],
    prompt_content: template?.prompt_content || '',
    mode: template?.mode || 'completion',
    model_name: template?.model_settings?.model_name || 'gpt-3.5-turbo',
    provider: 'openai', // hardcode for now
    model_parameters: template?.model_settings?.parameters || { temperature: 0.7 },
  })
  const [open, setOpen] = useState(false)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSelectChange = (item: {value: string | number}) => {
    setFormData(prev => ({ ...prev, mode: item.value as string }))
  }

  const handleTagsChange = (tags: string[]) => {
    setFormData(prev => ({ ...prev, tags }))
  }

  const handleModelChange = (model: { modelId: string; provider: string; }) => {
    setFormData(prev => ({
      ...prev,
      model_name: model.modelId,
      provider: model.provider,
      model_parameters: {},
    }))
  }

  const handleModelParamsChange = (params: FormValue) => {
    setFormData(prev => ({ ...prev, model_parameters: params }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const { provider, ...restData } = formData
    onSave(restData as PromptTemplateRequest)
  }
  
  const title = type === 'create' ? 'Create Prompt Template' : 'Edit Prompt Template'

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-6">{title}</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        {type === 'edit' && (
          <div>
            <label className="block text-sm font-medium text-gray-700">ID</label>
            <p className="mt-1 text-sm text-gray-500">{templateId}</p>
          </div>
        )}
        
      <div>
        <label className="block text-sm font-medium text-gray-700">Name</label>
        <Input
          name="name"
          value={formData.name}
          onChange={handleInputChange}
          className="mt-1 block w-full"
          required
        />
      </div>
        
      <div>
          <label className="block text-sm font-medium text-gray-700">Mode</label>
          <Select
            className="mt-1"
            defaultValue={formData.mode}
            onSelect={handleSelectChange}
            items={[
              { value: 'completion', name: 'Completion' },
              { value: 'chat', name: 'Chat' },
            ]}
            allowSearch={false}
        />
      </div>

      <div className=''>
        <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
        <PortalToFollowElem
            open={open}
            onOpenChange={setOpen}
            placement='bottom-end'
            offset={4}
        >
            <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)} className='block'>
                <Trigger
                    providerName={formData.provider}
                    modelId={formData.model_name}
                    disabled={false}
                />
            </PortalToFollowElemTrigger>
            <PortalToFollowElemContent>
                <ModelParameterModal
                    isAdvancedMode={true}
                    mode={formData.mode}
                    provider={formData.provider}
                    modelId={formData.model_name}
                    setModel={handleModelChange}
                    completionParams={formData.model_parameters}
                    onCompletionParamsChange={handleModelParamsChange}
                />
            </PortalToFollowElemContent>
        </PortalToFollowElem>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Prompt Content</label>
        <Textarea
          name="prompt_content"
          value={formData.prompt_content}
          onChange={handleInputChange}
          className="mt-1 block w-full"
          rows={10}
          required
        />
      </div>

      <div>
          <label className="block text-sm font-medium text-gray-700">Description</label>
          <Input
            name="description"
            value={formData.description!}
            onChange={handleInputChange}
            className="mt-1 block w-full"
            placeholder="Enter description"
          />
          </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Tags (comma-separated)</label>
          <TagInput
              items={formData.tags!}
              onChange={handleTagsChange}
          />
      </div>

        {type === 'edit' && template && (
            <div className="text-sm text-gray-500">
                Created: {formatDate(new Date(template.created_at), 'M/d/yyyy, h:mm:ss a')}
                <br />
                Last Updated: {formatDate(new Date(template.updated_at), 'M/d/yyyy, h:mm:ss a')}
            </div>
        )}

        <div className="flex justify-end space-x-2">
          <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">Save Changes</Button>
      </div>
    </form>
    </div>
  )
}

export default Form 