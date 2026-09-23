// Stable operation identities for the generated REST contract used by CLI resource clients.
export const catalogOperations: Record<string, string> = {
  'GET /account': 'account.get',
  'DELETE /account/sessions/self': 'account.sessions.revoke_current',
  'GET /account/sessions': 'account.sessions.list',
  'DELETE /account/sessions/{session_id}': 'account.sessions.revoke',
  'POST /workspaces/{workspace_id}/apps/imports': 'console_app.dsl.import',
  'POST /workspaces/{workspace_id}/apps/imports/{import_id}:confirm':
    'console_app.dsl.import_confirm',
  'GET /apps/{app_id}/dsl': 'console_app.dsl.export',
  'GET /apps/{app_id}/dependencies:check': 'console_app.dependencies.check',
  'GET /apps/{app_id}/human-input-forms/{form_token}': 'run.form.get',
  'POST /apps/{app_id}/human-input-forms/{form_token}:submit': 'run.form.submit',
  'POST /apps/{app_id}/workflow:run': 'console_app.workflow.run',
  'POST /apps/{app_id}/chat:run': 'console_app.chat.run',
  'POST /apps/{app_id}/advanced-chat:run': 'console_app.advanced_chat.run',
  'POST /apps/{app_id}/completion:run': 'console_app.completion.run',
  'POST /apps/{app_id}/tasks/{task_id}:stop': 'run.stop',
  'GET /apps/{app_id}': 'console_app.describe',
  'GET /apps': 'console_app.list',
  'GET /permitted-external-apps': 'console_app.external.list',
  'GET /permitted-external-apps/{app_id}': 'console_app.external.describe',
  'POST /apps/{app_id}/files': 'console_app.file.upload',
  'GET /workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs:ls':
    'knowledge_fs.ls',
  'GET /workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs:tree':
    'knowledge_fs.tree',
  'GET /workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs:grep':
    'knowledge_fs.grep',
  'GET /workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs:find':
    'knowledge_fs.find',
  'POST /workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs:diff':
    'knowledge_fs.diff',
  'GET /workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs:cat':
    'knowledge_fs.cat',
  'GET /workspaces/{workspace_id}/knowledge-fs/knowledge-spaces/{knowledge_space_id}/fs:stat':
    'knowledge_fs.stat',
  'GET /apps/{app_id}/tasks/{task_id}/events': 'run.events',
  'GET /workspaces': 'workspace.list',
  'GET /workspaces/{workspace_id}': 'workspace.get',
  'POST /workspaces/{workspace_id}:switch': 'workspace.switch',
  'GET /workspaces/{workspace_id}/members': 'workspace.members.list',
  'POST /workspaces/{workspace_id}/members': 'workspace.members.invite',
  'DELETE /workspaces/{workspace_id}/members/{member_id}': 'workspace.members.remove',
  'PATCH /workspaces/{workspace_id}/members/{member_id}': 'workspace.members.set_role',
}
