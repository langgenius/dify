// Types.d.ts
export const BASE_URL: string;

export type RequestMethods = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface Params {
  [key: string]: any;
}

interface HeaderParams {
  [key: string]: string;
}

interface User {
}

export declare class DifyClient {
  constructor(apiKey: string, baseUrl?: string);

  updateApiKey(apiKey: string): void;

  sendRequest(
    method: RequestMethods,
    endpoint: string,
    data?: any,
    params?: Params,
    stream?: boolean,
    headerParams?: HeaderParams
  ): Promise<any>;  

  messageFeedback(message_id: string, rating: number, user: User): Promise<any>;

  getApplicationParameters(user: User): Promise<any>;

  fileUpload(data: FormData): Promise<any>;

  textToAudio(text: string ,user: string, streaming?: boolean): Promise<any>;

  getMeta(user: User): Promise<any>;
}

export declare class CompletionClient extends DifyClient {
  createCompletionMessage(
    inputs: any,
    user: User,
    stream?: boolean,
    files?: File[] | null
  ): Promise<any>;
}

export declare class ChatClient extends DifyClient {
  createChatMessage(
    inputs: any,
    query: string,
    user: User,
    stream?: boolean,
    conversation_id?: string | null,
    files?: File[] | null
  ): Promise<any>;

  getSuggested(message_id: string, user: User): Promise<any>;

  stopMessage(task_id: string, user: User) : Promise<any>;


  getConversations(
    user: User, 
    first_id?: string | null, 
    limit?: number | null, 
    pinned?: boolean | null
  ): Promise<any>;

  getConversationMessages(
    user: User,
    conversation_id?: string,
    first_id?: string | null,
    limit?: number | null
  ): Promise<any>;

  renameConversation(conversation_id: string, name: string,  user: User,auto_generate:boolean): Promise<any>;

  deleteConversation(conversation_id: string, user: User): Promise<any>;
  
  audioToText(data: FormData): Promise<any>;
}

export declare class WorkflowClient extends DifyClient {
  run(inputs: any, user: User, stream?: boolean,): Promise<any>;

  stop(task_id: string, user: User): Promise<any>;
}