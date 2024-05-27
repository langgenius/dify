from events.app_event import app_was_deleted
from extensions.ext_database import db
from models.tools import WorkflowToolProvider


@app_was_deleted.connect
def handle(sender, **kwargs):
    app = sender
    workflow_tools = db.session.query(WorkflowToolProvider).filter(
        WorkflowToolProvider.app_id == app.id
    ).all()
    for workflow_tool in workflow_tools:
        db.session.delete(workflow_tool)
    db.session.commit()
