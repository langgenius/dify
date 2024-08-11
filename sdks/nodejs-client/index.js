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
  },
  runWorkflow: {
    method: "POST",
    url: () => `/workflows/run`,
  },
  createDataset: {
    method: "POST",
    url: () => `/datasets`,
  },
  listDatasets: {
    method: "GET",
    url: () => `/datasets`,
  },
  deleteDataset: {
    method: "DELETE",
    url: (dataset_id) => `/datasets/${dataset_id}`,
  },
  createDocumentByText: {
    method: "POST",
    url: (dataset_id) => `/datasets/${dataset_id}/document/create_by_text`,
  },
  createDocumentByFile: {
    method: "POST",
    url: (dataset_id) => `/datasets/${dataset_id}/document/create_by_file`,
  },
  updateDocumentByText: {
    method: "POST",
    url: (dataset_id, document_id) =>
      `/datasets/${dataset_id}/documents/${document_id}/update_by_text`,
  },
  updateDocumentByFile: {
    method: "POST",
    url: (dataset_id, document_id) =>
      `/datasets/${dataset_id}/documents/${document_id}/update_by_file`,
  },
  getDocumentEmbeddingStatus: {
    method: "GET",
    url: (dataset_id, batch) =>
      `/datasets/${dataset_id}/documents/${batch}/indexing-status`,
  },
  deleteDocument: {
    method: "DELETE",
    url: (dataset_id, document_id) =>
      `/datasets/${dataset_id}/documents/${document_id}`,
  },
  listDocuments: {
    method: "GET",
    url: (dataset_id) => `/datasets/${dataset_id}/documents`,
  },
  addDocumentSegment: {
    method: "POST",
    url: (dataset_id, document_id) => `/datasets/${dataset_id}/documents/${document_id}/segments`,
  },
  getDocumentSegments: {
    method: "GET",
    url: (dataset_id, document_id) => `/datasets/${dataset_id}/documents/${document_id}/segments`,
  },
  deleteDocumentSegment: {
    method: "DELETE",
    url: (dataset_id, document_id, segment_id) => `/datasets/${dataset_id}/documents/${document_id}/segments/${segment_id}`,
  },
  updateDocumentSegment: {
    method: "POST",
    url: (dataset_id, document_id, segment_id) => `/datasets/${dataset_id}/documents/${document_id}/segments/${segment_id}`,
  },
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
        validateStatus: false,
      });
    } else {
      response = await axios({
        method,
        url,
        ...(method !== "GET" && { data }),
        params,
        headers,
        responseType: "json",
        validateStatus: false,
      });
    }

    if (!response) {
      throw new Error("No response from server");
    }

    if (response?.data.code !== undefined && response.data.code !== 200) {
      throw new Error(
        `${response.data.status} ${response.data.code}: ${response.data.message}`
      );
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

  runWorkflow(inputs, user, stream = false, files = null) {
    const data = {
      inputs,
      user,
      response_mode: stream ? "streaming" : "blocking",
    };
    return this.sendRequest(
      routes.runWorkflow.method,
      routes.runWorkflow.url(),
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

export class DatasetClient extends DifyClient {
  async createDataset(name) {
    const data = { name };
    
    return this.sendRequest(
      routes.createDataset.method,
      routes.createDataset.url(),
      data,
    );
  }

  async listDatasets(params) {
    return this.sendRequest(
      routes.listDatasets.method,
      routes.listDatasets.url(),
      null,
      params,
    );
  }

  async deleteDataset(dataset_id) {
    return this.sendRequest(
      routes.deleteDataset.method,
      routes.deleteDataset.url(dataset_id),
    );
  }

  async createDocumentByText(dataset_id, options) {
    return this.sendRequest(
      routes.createDocumentByText.method,
      routes.createDocumentByText.url(dataset_id),
      options,
    );
  }

  async createDocumentByFile(dataset_id, options) {
    return this.sendRequest(
      routes.createDocumentByFile.method,
      routes.createDocumentByFile.url(dataset_id),
      options,
    );
  }

  async updateDocumentByText(dataset_id, document_id, options) {
    return this.sendRequest(
      routes.updateDocumentByText.method,
      routes.updateDocumentByText.url(dataset_id, document_id),
      options,
    );
  }

  async updateDocumentByFile(dataset_id, document_id, options) {
    return this.sendRequest(
      routes.updateDocumentByFile.method,
      routes.updateDocumentByFile.url(dataset_id, document_id),
      options,
    );
  }

  async getDocumentEmbeddingStatus(dataset_id, batch) {
    return this.sendRequest(
      routes.getDocumentEmbeddingStatus.method,
      routes.getDocumentEmbeddingStatus.url(dataset_id, batch),
    );
  }

  async deleteDocument(dataset_id, document_id) {
    return this.sendRequest(
      routes.deleteDocument.method,
      routes.deleteDocument.url(dataset_id, document_id),
    );
  }

  async listDocuments(dataset_id, params) {
    return this.sendRequest(
      routes.listDocuments.method,
      routes.listDocuments.url(dataset_id),
      null,
      params,
    );
  }

  async addDocumentSegment(dataset_id, document_id, options) {
    return this.sendRequest(
      routes.addDocumentSegment.method,
      routes.addDocumentSegment.url(dataset_id, document_id),
      options,
    );
  }

  async getDocumentSegments(dataset_id, document_id, params) {
    return this.sendRequest(
      routes.getDocumentSegments.method,
      routes.getDocumentSegments.url(dataset_id, document_id),
      null,
      params,
    );
  }

  async deleteDocumentSegment(dataset_id, document_id, segment_id) {
    return this.sendRequest(
      routes.deleteDocumentSegment.method,
      routes.deleteDocumentSegment.url(dataset_id, document_id, segment_id),
    );
  }

  async updateDocumentSegment(dataset_id, document_id, segment_id, options) {
    return this.sendRequest(
      routes.updateDocumentSegment.method,
      routes.updateDocumentSegment.url(dataset_id, document_id, segment_id),
      options,
    );
  }
}