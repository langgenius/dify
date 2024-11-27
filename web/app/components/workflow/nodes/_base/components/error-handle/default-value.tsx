import type { DefaultValueForm } from './types'
import Input from '@/app/components/base/input'
import { VarType } from '@/app/components/workflow/types'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { TransferMethod } from '@/types/app'

type DefaultValueProps = {
  forms: DefaultValueForm[]
}
const DefaultValue = ({
  forms,
}: DefaultValueProps) => {
  return (
    <div className='px-4 pt-2'>
      <div className='mb-2 body-xs-regular text-text-tertiary'>On error, will return below value</div>
      <div className='space-y-1'>
        {
          forms.map((form, index) => {
            return (
              <div
                key={index}
                className='py-1'
              >
                <div className='flex items-center mb-1'>
                  <div className='mr-1 system-sm-medium text-text-primary'>{form.variable}</div>
                  <div className='system-xs-regular text-text-tertiary'>{form.type}</div>
                </div>
                {
                  (form.type === VarType.string || form.type === VarType.number) && (
                    <Input
                      type={form.type}
                    />
                  )
                }
                {
                  form.type === VarType.file && (
                    <FileUploaderInAttachmentWrapper
                      value={[]}
                      onChange={() => {}}
                      fileConfig={{
                        number_limits: 1,
                        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
                      }}
                    />
                  )
                }
                {
                  form.type === VarType.arrayFile && (
                    <FileUploaderInAttachmentWrapper
                      value={[]}
                      onChange={() => {}}
                      fileConfig={{
                        number_limits: 10,
                        allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
                      }}
                    />
                  )
                }
                {
                  (
                    form.type === VarType.array
                    || form.type === VarType.arrayNumber
                    || form.type === VarType.arrayString
                    || form.type === VarType.arrayObject
                    || form.type === VarType.object
                  ) && (
                    <CodeEditor
                      language={CodeLanguage.json}
                      onChange={() => {}}
                    />
                  )
                }
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

export default DefaultValue
