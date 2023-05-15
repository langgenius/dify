import axios from 'axios'

const BASE_URL = 'https://api.dify.ai/v1'

const routes = {
  application: {
    method: 'GET',
    url: () => `/parameters`
  },
  feedback: {
    method: 'POST',
    url: (messageId) => `/messages/${messageId}/feedbacks`,
  },
  createCompletionMessage: {
    method: 'POST',
    url: () => `/completion-messages`,
  },
  createChatMessage: {
    method: 'POST',
    url: () => `/chat-messages`,
  },
  getConversationMessages: {
    method: 'GET',
    url: () => '/messages',
  },
  getConversations: {
    method: 'GET',
    url: () => '/conversations',
  },
  renameConversation: {
    method: 'PATCH',
    url: (conversationId) => `/conversations/${conversationId}`,
  }

}

export class DifyClient {
  constructor(apiKey, baseUrl = BASE_URL) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl
  }

  updateApiKey(apiKey) {
    this.apiKey = apiKey
  }

  async sendRequest(method, endpoint, data = null, params = null, stream = false) {
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }

    const url = `${this.baseUrl}${endpoint}`
    let response
    if (!stream) {
      response = await axios({
        method,
        url,
        data,
        params,
        headers,
        responseType: stream ? 'stream' : 'json',
      })
    } else {
      response = await fetch(url, {
        headers,
        method,
        body: JSON.stringify(data),
      })
    }

    return response
  }

  messageFeedback(messageId, rating, user) {
    const data = {
      rating,
      user,
    }
    return this.sendRequest(routes.feedback.method, routes.feedback.url(messageId), data)
  }

  getApplicationParameters(user) {
    const params = { user }
    return this.sendRequest(routes.application.method, routes.application.url(), null, params)
  }
}

export class CompletionClient extends DifyClient {
  createCompletionMessage(inputs, query, user, responseMode) {
    const data = {
      inputs,
      query,
      responseMode,
      user,
    }
    return this.sendRequest(routes.createCompletionMessage.method, routes.createCompletionMessage.url(), data, null, responseMode === 'streaming')
  }
}

export class ChatClient extends DifyClient {
  createChatMessage(inputs, query, user, responseMode = 'blocking', conversationId = null) {
    const data = {
      inputs,
      query,
      user,
      responseMode,
    }
    if (conversationId)
      data.conversation_id = conversationId

    return this.sendRequest(routes.createChatMessage.method, routes.createChatMessage.url(), data, null, responseMode === 'streaming')
  }

  getConversationMessages(user, conversationId = '', firstId = null, limit = null) {
    const params = { user }

    if (conversationId)
      params.conversation_id = conversationId

    if (firstId)
      params.first_id = firstId

    if (limit)
      params.limit = limit

    return this.sendRequest(routes.getConversationMessages.method, routes.getConversationMessages.url(), null, params)
  }

  getConversations(user, firstId = null, limit = null, pinned = null) {
    const params = { user, first_id: firstId, limit, pinned }
    return this.sendRequest(routes.getConversations.method, routes.getConversations.url(), null, params)
  }

  renameConversation(conversationId, name, user) {
    const data = { name, user }
    return this.sendRequest(routes.renameConversation.method, routes.renameConversation.url(conversationId), data)
  }
}

