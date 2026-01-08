import { FormTypeEnum } from '@/app/components/base/form/types'

export const SANDBOX_FIELD_CONFIGS = {
  api_key: {
    labelKey: 'sandboxProvider.configModal.apiKey',
    placeholderKey: 'sandboxProvider.configModal.apiKeyPlaceholder',
    type: FormTypeEnum.secretInput,
  },
  e2b_api_url: {
    labelKey: 'sandboxProvider.configModal.e2bApiUrl',
    placeholderKey: 'sandboxProvider.configModal.e2bApiUrlPlaceholder',
    type: FormTypeEnum.textInput,
  },
  e2b_default_template: {
    labelKey: 'sandboxProvider.configModal.e2bTemplate',
    placeholderKey: 'sandboxProvider.configModal.e2bTemplatePlaceholder',
    type: FormTypeEnum.textInput,
  },
  docker_sock: {
    labelKey: 'sandboxProvider.configModal.dockerSock',
    placeholderKey: 'sandboxProvider.configModal.dockerSockPlaceholder',
    type: FormTypeEnum.textInput,
  },
  docker_image: {
    labelKey: 'sandboxProvider.configModal.dockerImage',
    placeholderKey: 'sandboxProvider.configModal.dockerImagePlaceholder',
    type: FormTypeEnum.textInput,
  },
  base_working_path: {
    labelKey: 'sandboxProvider.configModal.baseWorkingPath',
    placeholderKey: 'sandboxProvider.configModal.baseWorkingPathPlaceholder',
    type: FormTypeEnum.textInput,
  },
} as const

export const PROVIDER_DOC_LINKS: Record<string, string> = {
  e2b: 'https://e2b.dev/docs',
  docker: 'https://docs.docker.com/',
  local: '',
}
