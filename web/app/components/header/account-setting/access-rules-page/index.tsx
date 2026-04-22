import { Button } from '@langgenius/dify-ui/button'

const AccessRulesPage = () => {
  return (
    <>
      <div className="flex flex-col">
        <div className="mb-8 flex items-center gap-3">
          <div className="system-sm-semibold-uppercase text-text-secondary">
            App Access Rules
          </div>
          <Button
            variant="secondary"
            size="medium"
          >
            Create App permission set
          </Button>
        </div>
      </div>
    </>
  )
}

export default AccessRulesPage
