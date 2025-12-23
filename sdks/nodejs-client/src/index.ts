import { DEFAULT_BASE_URL } from "./types/common";

export const BASE_URL = DEFAULT_BASE_URL;

export const routes = {
  feedback: {
    method: "POST",
    url: (messageId: string) => `/messages/${messageId}/feedbacks`,
  },
  application: {
    method: "GET",
    url: () => "/parameters",
  },
  fileUpload: {
    method: "POST",
    url: () => "/files/upload",
  },
  filePreview: {
    method: "GET",
    url: (fileId: string) => `/files/${fileId}/preview`,
  },
  textToAudio: {
    method: "POST",
    url: () => "/text-to-audio",
  },
  audioToText: {
    method: "POST",
    url: () => "/audio-to-text",
  },
  getMeta: {
    method: "GET",
    url: () => "/meta",
  },
  getInfo: {
    method: "GET",
    url: () => "/info",
  },
  getSite: {
    method: "GET",
    url: () => "/site",
  },
  createCompletionMessage: {
    method: "POST",
    url: () => "/completion-messages",
  },
  stopCompletionMessage: {
    method: "POST",
    url: (taskId: string) => `/completion-messages/${taskId}/stop`,
  },
  createChatMessage: {
    method: "POST",
    url: () => "/chat-messages",
  },
  getSuggested: {
    method: "GET",
    url: (messageId: string) => `/messages/${messageId}/suggested`,
  },
  stopChatMessage: {
    method: "POST",
    url: (taskId: string) => `/chat-messages/${taskId}/stop`,
  },
  getConversations: {
    method: "GET",
    url: () => "/conversations",
  },
  getConversationMessages: {
    method: "GET",
    url: () => "/messages",
  },
  renameConversation: {
    method: "POST",
    url: (conversationId: string) => `/conversations/${conversationId}/name`,
  },
  deleteConversation: {
    method: "DELETE",
    url: (conversationId: string) => `/conversations/${conversationId}`,
  },
  runWorkflow: {
    method: "POST",
    url: () => "/workflows/run",
  },
  stopWorkflow: {
    method: "POST",
    url: (taskId: string) => `/workflows/tasks/${taskId}/stop`,
  },
};

export { DifyClient } from "./client/base";
export { ChatClient } from "./client/chat";
export { CompletionClient } from "./client/completion";
export { WorkflowClient } from "./client/workflow";
export { KnowledgeBaseClient } from "./client/knowledge-base";
export { WorkspaceClient } from "./client/workspace";

export * from "./errors/dify-error";
export * from "./types/common";
export * from "./types/annotation";
export * from "./types/chat";
export * from "./types/completion";
export * from "./types/knowledge-base";
export * from "./types/workflow";
export * from "./types/workspace";
export { HttpClient } from "./http/client";
