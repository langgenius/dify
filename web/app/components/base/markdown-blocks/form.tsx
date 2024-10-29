import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { useChatContext } from '@/app/components/base/chat/chat/context'

const MarkdownForm = ({ node }: any) => {
  // const supportedTypes = ['text', 'password', 'email', 'number', 'radio']
  //   <form>
  //      <label for="username">Username:</label>
  //      <input type="text" name="username" />
  //      <label for="password">Password:</label>
  //      <input type="password" name="password" />
  //      <label for="content">Content:</label>
  //      <textarea name="content"></textarea>
  //      <button>Login</button>
  //   </form>
  const { onSend } = useChatContext()

  const getFormValues = (children: any) => {
    const formValues: { [key: string]: any } = {}
    children.forEach((child: any) => {
      if (child.tagName === 'input')
        formValues[child.properties.name] = child.properties.value
      if (child.tagName === 'textarea')
        formValues[child.properties.name] = child.properties.value
    })
    return formValues
  }

  return (
    <form
      className='flex flex-col self-stretch'
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {node.children.map((child: any, index: number) => {
        console.log(child)
        if (child.tagName === 'label') {
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
        if (child.tagName === 'input') {
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
        if (child.tagName === 'textarea') {
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
        if (child.tagName === 'button') {
          const variant = child.properties.dataVariant
          const size = child.properties.dataSize

          return (
            <Button
              variant={variant}
              size={size}
              className='mt-4'
              key={index}
              onClick={(e) => {
                e.preventDefault()
                const result = JSON.stringify(getFormValues(node.children))
                onSend?.(result)
              }}
            >
              <span className='text-[13px]'>{child.children[0]?.value || ''}</span>
            </Button>
          )
        }

        return null
      })}
    </form>
  )
}
MarkdownForm.displayName = 'MarkdownForm'
export default MarkdownForm
