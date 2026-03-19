SYSTEM_VARIABLE_NODE_ID = "sys"
ENVIRONMENT_VARIABLE_NODE_ID = "env"
CONVERSATION_VARIABLE_NODE_ID = "conversation"
RAG_PIPELINE_VARIABLE_NODE_ID = "rag"

# Reserved for internal workflow-to-workflow HTTP calls. External callers should
# not rely on or set this header.
WORKFLOW_CALL_DEPTH_HEADER = "X-Dify-Workflow-Call-Depth"
WORKFLOW_CALL_DEPTH_SIGNATURE_HEADER = "X-Dify-Workflow-Call-Depth-Signature"
