import { get, post } from './base'
import type {
  FileUploadConfigResponse,
  StructuredOutputRulesRequestBody,
  StructuredOutputRulesResponse,
} from '@/models/common'
import { useMutation, useQuery } from '@tanstack/react-query'

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

export type MailRegisterResponse = { result: string, data: { access_token: string, refresh_token: string } }

export const useMailRegister = () => {
  return useMutation({
    mutationKey: [NAME_SPACE, 'mail-register'],
    mutationFn: (body: { token: string, new_password: string, password_confirm: string }) => {
      return post<MailRegisterResponse>('/email-register', { body })
    },
  })
}
