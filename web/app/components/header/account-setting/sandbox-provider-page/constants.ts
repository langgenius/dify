import { FormTypeEnum } from '@/app/components/base/form/types'

export const PROVIDER_ICONS: Record<string, string> = {
  e2b: '/sandbox-providers/e2b.svg',
  daytona: '/sandbox-providers/daytona.svg',
  docker: '/sandbox-providers/docker.svg',
  local: '/sandbox-providers/local.svg',
  ssh: '/sandbox-providers/ssh.svg',
}

export const PROVIDER_LABEL_KEYS = {
  e2b: 'sandboxProvider.e2b.label',
  daytona: 'sandboxProvider.daytona.label',
  docker: 'sandboxProvider.docker.label',
  local: 'sandboxProvider.local.label',
  ssh: 'sandboxProvider.ssh.label',
} as const

export const PROVIDER_DESCRIPTION_KEYS = {
  e2b: 'sandboxProvider.e2b.description',
  daytona: 'sandboxProvider.daytona.description',
  docker: 'sandboxProvider.docker.description',
  local: 'sandboxProvider.local.description',
  ssh: 'sandboxProvider.ssh.description',
} as const

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
  ssh_host: {
    labelKey: 'sandboxProvider.configModal.sshHost',
    placeholderKey: 'sandboxProvider.configModal.sshHostPlaceholder',
    type: FormTypeEnum.textInput,
  },
  ssh_port: {
    labelKey: 'sandboxProvider.configModal.sshPort',
    placeholderKey: 'sandboxProvider.configModal.sshPortPlaceholder',
    type: FormTypeEnum.textInput,
  },
  ssh_username: {
    labelKey: 'sandboxProvider.configModal.sshUsername',
    placeholderKey: 'sandboxProvider.configModal.sshUsernamePlaceholder',
    type: FormTypeEnum.textInput,
  },
  ssh_password: {
    labelKey: 'sandboxProvider.configModal.sshPassword',
    placeholderKey: 'sandboxProvider.configModal.sshPasswordPlaceholder',
    type: FormTypeEnum.secretInput,
  },
} as const

export const PROVIDER_DOC_LINKS: Record<string, string> = {
  e2b: 'https://e2b.dev/docs',
  daytona: 'https://www.daytona.io/docs',
  docker: 'https://docs.docker.com/',
  local: '',
  ssh: 'https://www.openssh.com/manual.html',
}
