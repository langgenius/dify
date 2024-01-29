import axios from "axios";
export const BASE_URL = "https://api.dify.ai/v1";

export const routes = {
  application: {
    method: "GET",
    url: () => `/parameters`,
  },
  feedback: {
    method: "POST",
    url: (message_id) => `/messages/${message_id}/feedbacks`,
  },
  createCompletionMessage: {
    method: "POST",
    url: () => `/completion-messages`,
  },
  createChatMessage: {
    method: "POST",
    url: () => `/chat-messages`,
  },
  getConversationMessages: {
    method: "GET",
    url: () => `/messages`,
  },
  getConversations: {
    method: "GET",
    url: () => `/conversations`,
  },
  renameConversation: {
    method: "POST",
    url: (conversation_id) => `/conversations/${conversation_id}/name`,
  },
  deleteConversation: {
    method: "DELETE",
    url: (conversation_id) => `/conversations/${conversation_id}`,
  },
  fileUpload: {
    method: "POST",
    url: () => `/files/upload`,
  }
};

export class DifyClient {
  constructor(apiKey, baseUrl = BASE_URL) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  updateApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  async sendRequest(
    method,
    endpoint,
    data = null,
    params = null,
    stream = false,
    headerParams = {}
  ) {
    const headers = {
      ...{
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      ...headerParams
    };

    const url = `${this.baseUrl}${endpoint}`;
    let response;
    if (stream) {
      response = await axios({
        method,
        url,
        data,
        params,
        headers,
        responseType: "stream",
      });
    } else {
      response = await axios({
        method,
        url,
        data,
        params,
        headers,
        responseType: "json",
      });
    }

    return response;
  }

  messageFeedback(message_id, rating, user) {
    const data = {
      rating,
      user,
    };
    return this.sendRequest(
      routes.feedback.method,
      routes.feedback.url(message_id),
      data
    );
  }

  getApplicationParameters(user) {
    const params = { user };
    return this.sendRequest(
      routes.application.method,
      routes.application.url(),
      null,
      params
    );
  }

  fileUpload(data) {
    return this.sendRequest(
      routes.fileUpload.method,
      routes.fileUpload.url(),
      data,
      null,
      false,
      {
        "Content-Type": 'multipart/form-data'
      }
    );
  }
}

export class CompletionClient extends DifyClient {
  createCompletionMessage(inputs, user, stream = false, files = null) {
    const data = {
      inputs,
      user,
      response_mode: stream ? "streaming" : "blocking",
      files,
    };
    return this.sendRequest(
      routes.createCompletionMessage.method,
      routes.createCompletionMessage.url(),
      data,
      null,
      stream
    );
  }
}

export class ChatClient extends DifyClient {
  createChatMessage(
    inputs,
    query,
    user,
    stream = false,
    conversation_id = null,
    files = null
  ) {
    const data = {
      inputs,
      query,
      user,
      response_mode: stream ? "streaming" : "blocking",
      files,
    };
    if (conversation_id) data.conversation_id = conversation_id;

    return this.sendRequest(
      routes.createChatMessage.method,
      routes.createChatMessage.url(),
      data,
      null,
      stream
    );
  }

  getConversationMessages(
    user,
    conversation_id = "",
    first_id = null,
    limit = null
  ) {
    const params = { user };

    if (conversation_id) params.conversation_id = conversation_id;

    if (first_id) params.first_id = first_id;

    if (limit) params.limit = limit;

    return this.sendRequest(
      routes.getConversationMessages.method,
      routes.getConversationMessages.url(),
      null,
      params
    );
  }

  getConversations(user, first_id = null, limit = null, pinned = null) {
    const params = { user, first_id: first_id, limit, pinned };
    return this.sendRequest(
      routes.getConversations.method,
      routes.getConversations.url(),
      null,
      params
    );
  }

  renameConversation(conversation_id, name, user, auto_generate) {
    const data = { name, user, auto_generate };
    return this.sendRequest(
      routes.renameConversation.method,
      routes.renameConversation.url(conversation_id),
      data
    );
  }

  deleteConversation(conversation_id, user) {
    const data = { user };
    return this.sendRequest(
      routes.deleteConversation.method,
      routes.deleteConversation.url(conversation_id),
      data
    );
  }
}