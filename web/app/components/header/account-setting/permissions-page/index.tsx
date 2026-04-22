import { Button } from '@langgenius/dify-ui/button'

const PermissionsPage = () => {
  return (
    <>
      <div className="flex flex-col">
        <div className="mb-4 flex items-center gap-3 rounded-xl border-t-[0.5px] border-l-[0.5px] border-divider-subtle bg-linear-to-bl from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-3 pr-5">
          <div className="flex grow flex-col gap-y-1">
            <div className="system-md-semibold text-text-primary">
              Default Global
            </div>
            <div className="system-sm-regular text-text-tertiary">
              A default global permission scheme applied to the workspace
            </div>
          </div>
          <div className="flex items-center">
            <Button
              variant="primary"
              size="small"
            >
              + Add Role
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

export default PermissionsPage
