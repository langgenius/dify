import { FormTypeEnum } from '@/app/components/base/form/types'

export const PROVIDER_ICONS: Record<string, string> = {
  e2b: '/sandbox-providers/e2b.svg',
  daytona: '/sandbox-providers/daytona.svg',
  docker: '/sandbox-providers/docker.svg',
  local: '/sandbox-providers/local.svg',
  ssh: '/sandbox-providers/ssh.svg',
}

export const PROVIDER_STATIC_LABELS = {
  e2b: 'E2B',
  daytona: 'Daytona',
  docker: 'Docker',
  local: 'Local',
  ssh: 'SSH',
} as const

export const PROVIDER_DESCRIPTION_KEYS = {
  e2b: 'sandboxProvider.e2b.description',
  daytona: 'sandboxProvider.daytona.description',
  docker: 'sandboxProvider.docker.description',
  local: 'sandboxProvider.local.description',
  ssh: 'sandboxProvider.ssh.description',
} as const

type SandboxFieldConfig = {
  labelKey:
    | 'sandboxProvider.configModal.apiKey'
    | 'sandboxProvider.configModal.e2bApiUrl'
    | 'sandboxProvider.configModal.e2bTemplate'
    | 'sandboxProvider.configModal.dockerSock'
    | 'sandboxProvider.configModal.dockerImage'
    | 'sandboxProvider.configModal.baseWorkingPath'
    | 'sandboxProvider.configModal.sshHost'
    | 'sandboxProvider.configModal.sshPort'
    | 'sandboxProvider.configModal.sshUsername'
    | 'sandboxProvider.configModal.sshPassword'
  placeholderKey?:
    | 'sandboxProvider.configModal.apiKeyPlaceholder'
    | 'sandboxProvider.configModal.e2bTemplatePlaceholder'
    | 'sandboxProvider.configModal.sshUsernamePlaceholder'
    | 'sandboxProvider.configModal.sshPasswordPlaceholder'
  placeholder?: string
  type: FormTypeEnum
}

export const SANDBOX_FIELD_CONFIGS: Record<string, SandboxFieldConfig> = {
  api_key: {
    labelKey: 'sandboxProvider.configModal.apiKey',
    placeholderKey: 'sandboxProvider.configModal.apiKeyPlaceholder',
    type: FormTypeEnum.secretInput,
  },
  e2b_api_url: {
    labelKey: 'sandboxProvider.configModal.e2bApiUrl',
    placeholder: 'https://api.e2b.app',
    type: FormTypeEnum.textInput,
  },
  e2b_default_template: {
    labelKey: 'sandboxProvider.configModal.e2bTemplate',
    placeholderKey: 'sandboxProvider.configModal.e2bTemplatePlaceholder',
    type: FormTypeEnum.textInput,
  },
  docker_sock: {
    labelKey: 'sandboxProvider.configModal.dockerSock',
    placeholder: 'unix:///var/run/docker.sock',
    type: FormTypeEnum.textInput,
  },
  docker_image: {
    labelKey: 'sandboxProvider.configModal.dockerImage',
    placeholder: 'ubuntu:latest',
    type: FormTypeEnum.textInput,
  },
  base_working_path: {
    labelKey: 'sandboxProvider.configModal.baseWorkingPath',
    placeholder: '/workspace/sandboxes',
    type: FormTypeEnum.textInput,
  },
  ssh_host: {
    labelKey: 'sandboxProvider.configModal.sshHost',
    placeholder: 'e.g. 127.0.0.1 or agentbox',
    type: FormTypeEnum.textInput,
  },
  ssh_port: {
    labelKey: 'sandboxProvider.configModal.sshPort',
    placeholder: '22',
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
}

export const PROVIDER_DOC_LINKS: Record<string, string> = {
  e2b: 'https://e2b.dev/docs',
  daytona: 'https://www.daytona.io/docs',
  docker: 'https://docs.docker.com/',
  local: '',
  ssh: 'https://www.openssh.com/manual.html',
}
