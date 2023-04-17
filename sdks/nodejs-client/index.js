import axios from 'axios'

export class LangGeniusClient {
  constructor(apiKey, baseUrl = 'https://api.langgenius.ai/v1') {
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
    return this.sendRequest('POST', `/messages/${messageId}/feedbacks`, data)
  }

  getApplicationParameters(user) {
    const params = { user }
    return this.sendRequest('GET', '/parameters', null, params)
  }
}

export class CompletionClient extends LangGeniusClient {
  createCompletionMessage(inputs, query, responseMode, user) {
    const data = {
      inputs,
      query,
      responseMode,
      user,
    }
    return this.sendRequest('POST', '/completion-messages', data, null, responseMode === 'streaming')
  }
}

export class ChatClient extends LangGeniusClient {
  createChatMessage(inputs, query, user, responseMode = 'blocking', conversationId = null) {
    const data = {
      inputs,
      query,
      user,
      responseMode,
    }
    if (conversationId)
      data.conversation_id = conversationId

    return this.sendRequest('POST', '/chat-messages', data, null, responseMode === 'streaming')
  }

  getConversationMessages(user, conversationId = '', firstId = null, limit = null) {
    const params = { user }

    if (conversationId)
      params.conversation_id = conversationId

    if (firstId)
      params.first_id = firstId

    if (limit)
      params.limit = limit

    return this.sendRequest('GET', '/messages', null, params)
  }

  getConversations(user, firstId = null, limit = null, pinned = null) {
    const params = { user, first_id: firstId, limit, pinned }
    return this.sendRequest('GET', '/conversations', null, params)
  }

  renameConversation(conversationId, name, user) {
    const data = { name, user }
    return this.sendRequest('PATCH', `/conversations/${conversationId}`, data)
  }
}

