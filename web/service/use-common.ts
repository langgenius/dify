import { get, post } from './base'
import type {
  FileUploadConfigResponse,
  Member,
  StructuredOutputRulesRequestBody,
  StructuredOutputRulesResponse,
} from '@/models/common'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { FileTypesRes } from './datasets'

const NAME_SPACE = 'common'

export const useFileUploadConfig = () => {
  return useQuery<FileUploadConfigResponse>({
    queryKey: [NAME_SPACE, 'file-upload-config'],
    queryFn: () => get<FileUploadConfigResponse>('/files/upload'),
  })
}

export const useGenerateStructuredOutputRules = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'generate-structured-output-rules'],
    mutationFn: (body: StructuredOutputRulesRequestBody) => {
      return post<StructuredOutputRulesResponse>(
        '/rule-structured-output-generate',
        { body },
      )
    },
  })
}

export type MailSendResponse = { data: string, result: string }
export const useSendMail = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-send'],
    mutationFn: (body: { email: string, language: string }) => {
      return post<MailSendResponse>('/email-register/send-email', { body })
    },
  })
}

export type MailValidityResponse = { is_valid: boolean, token: string }

export const useMailValidity = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-validity'],
    mutationFn: (body: { email: string, code: string, token: string }) => {
      return post<MailValidityResponse>('/email-register/validity', { body })
    },
  })
}

export type MailRegisterResponse = { result: string, data: {} }

export const useMailRegister = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-register'],
    mutationFn: (body: { token: string, new_password: string, password_confirm: string }) => {
      return post<MailRegisterResponse>('/email-register', { body })
    },
  })
}

export const useFileSupportTypes = () => {
  return useQuery<FileTypesRes>({
    queryKey: [NAME_SPACE, 'file-types'],
    queryFn: () => get<FileTypesRes>('/files/support-type'),
  })
}

type MemberResponse = {
  accounts: Member[] | null
}

export const useMembers = () => {
  return useQuery<MemberResponse>({
    queryKey: [NAME_SPACE, 'members'],
    queryFn: (params: Record<string, any>) => get<MemberResponse>('/workspaces/current/members', {
      params,
    }),
  })
}

type FilePreviewResponse = {
  content: string
}

export const useFilePreview = (fileID: string) => {
  return useQuery<FilePreviewResponse>({
    queryKey: [NAME_SPACE, 'file-preview', fileID],
    queryFn: () => get<FilePreviewResponse>(`/files/${fileID}/preview`),
    enabled: !!fileID,
  })
}

export type SchemaTypeDefinition = {
  name: string
  schema: {
    properties: Record<string, any>
  }
}

export const useSchemaTypeDefinitions = () => {
  return useQuery<SchemaTypeDefinition[]>({
    queryKey: [NAME_SPACE, 'schema-type-definitions'],
    queryFn: () => get<SchemaTypeDefinition[]>('/spec/schema-definitions'),
  })
}

type isLogin = {
  logged_in: boolean
}

export const useIsLogin = () => {
  return useQuery<isLogin>({
    queryKey: [NAME_SPACE, 'is-login'],
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<isLogin> => {
      try {
        await get('/account/profile', {}, {
          silent: true,
        })
      }
      catch (e: any) {
        if(e.status === 401)
          return { logged_in: false }
        return { logged_in: true }
      }
      return { logged_in: true }
    },
  })
}

export const useLogout = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'logout'],
    mutationFn: () => post('/logout'),
  })
}
