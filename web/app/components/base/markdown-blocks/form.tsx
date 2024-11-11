import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { useChatContext } from '@/app/components/base/chat/chat/context'

enum DATA_FORMAT {
  TEXT = 'text',
  JSON = 'json',
}
enum SUPPORTED_TAGS {
  LABEL = 'label',
  INPUT = 'input',
  TEXTAREA = 'textarea',
  BUTTON = 'button',
}
enum SUPPORTED_TYPES {
  TEXT = 'text',
  PASSWORD = 'password',
  EMAIL = 'email',
  NUMBER = 'number',
}
const MarkdownForm = ({ node }: any) => {
  // const supportedTypes = ['text', 'password', 'email', 'number']
  //   <form data-format="text">
  //      <label for="username">Username:</label>
  //      <input type="text" name="username" />
  //      <label for="password">Password:</label>
  //      <input type="password" name="password" />
  //      <label for="content">Content:</label>
  //      <textarea name="content"></textarea>
  //      <button data-size="small" data-variant="primary">Login</button>
  //   </form>
  const { onSend } = useChatContext()

  const getFormValues = (children: any) => {
    const formValues: { [key: string]: any } = {}
    children.forEach((child: any) => {
      if (child.tagName === SUPPORTED_TAGS.INPUT)
        formValues[child.properties.name] = child.properties.value
      if (child.tagName === SUPPORTED_TAGS.TEXTAREA)
        formValues[child.properties.name] = child.properties.value
    })
    return formValues
  }
  const onSubmit = (e: any) => {
    e.preventDefault()
    const format = node.properties.dataFormat || DATA_FORMAT.TEXT
    const result = getFormValues(node.children)
    if (format === DATA_FORMAT.JSON) {
      onSend?.(JSON.stringify(result))
    }
    else {
      const textResult = Object.entries(result)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')
      onSend?.(textResult)
    }
  }
  return (
    <form
      autoComplete="off"
      className='flex flex-col self-stretch'
      onSubmit={(e: any) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {node.children.filter((i: any) => i.type === 'element').map((child: any, index: number) => {
        if (child.tagName === SUPPORTED_TAGS.LABEL) {
          return (
            <label
              key={index}
              htmlFor={child.properties.for}
              className="my-2 system-md-semibold text-text-secondary"
            >
              {child.children[0]?.value || ''}
            </label>
          )
        }
        if (child.tagName === SUPPORTED_TAGS.INPUT) {
          if (Object.values(SUPPORTED_TYPES).includes(child.properties.type)) {
            return (
              <Input
                key={index}
                type={child.properties.type}
                name={child.properties.name}
                placeholder={child.properties.placeholder}
                value={child.properties.value}
                onChange={(e) => {
                  e.preventDefault()
                  child.properties.value = e.target.value
                }}
              />
            )
          }
          else {
            return <p key={index}>Unsupported input type: {child.properties.type}</p>
          }
        }
        if (child.tagName === SUPPORTED_TAGS.TEXTAREA) {
          return (
            <Textarea
              key={index}
              name={child.properties.name}
              placeholder={child.properties.placeholder}
              value={child.properties.value}
              onChange={(e) => {
                e.preventDefault()
                child.properties.value = e.target.value
              }}
            />
          )
        }
        if (child.tagName === SUPPORTED_TAGS.BUTTON) {
          const variant = child.properties.dataVariant
          const size = child.properties.dataSize

          return (
            <Button
              variant={variant}
              size={size}
              className='mt-4'
              key={index}
              onClick={onSubmit}
            >
              <span className='text-[13px]'>{child.children[0]?.value || ''}</span>
            </Button>
          )
        }

        return <p key={index}>Unsupported tag: {child.tagName}</p>
      })}
    </form>
  )
}
MarkdownForm.displayName = 'MarkdownForm'
export default MarkdownForm
