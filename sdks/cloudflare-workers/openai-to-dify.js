addEventListener('fetch', event => {
    if (event.request.method === 'OPTIONS') {
        event.respondWith(handleOptions(event.request))
    } else if (event.request.method === 'POST') {
        event.respondWith(handleRequest(event.request))
    } else {
        event.respondWith(new Response('Method Not Allowed', { status: 405 }))
    }
})

async function handleOptions(request) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': 'true',
    }
    return new Response(null, { headers })
}

class LineBreakTransformer {
    constructor() {
        this.container = ''
    }

    transform(chunk, controller) {
        // chunk is a Uint8Array, needs to be converted to a string
        chunk = new TextDecoder("utf-8").decode(chunk)
        this.container += chunk
        const lines = this.container.split('\n\n')
        // If there is only one line, it means it's incomplete, wait for the next chunk
        if (lines.length === 1) {
            return
        }
        // If there are multiple lines, the last line is incomplete and needs to be preserved
        this.container = lines.pop()
        console.log(lines)
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                // I don't know why, but the first line is always 'data: ping' or 'data: pong'
                if(line == 'data: ping' || line == 'data: pong'){
                    continue
                }
                const difyResponse = JSON.parse(line.slice(6))
                if (difyResponse.event === 'message' || difyResponse.event === 'agent_message') {
                    const completionChunk = {
                        id: difyResponse.message_id,
                        object: 'chat.completion.chunk',
                        created: difyResponse.created_at,
                        model: 'gpt-3.5-turbo',
                        choices: [
                            {
                                delta: {
                                    content: difyResponse.answer,
                                },
                                finish_reason: null,
                            },
                        ],
                    }
                    controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(completionChunk) + '\n\n'))
                }else if (difyResponse.event === 'agent_thought') {
                    const completionChunk = {
                        id: difyResponse.message_id,
                        object: 'chat.completion.chunk',
                        created: difyResponse.created_at,
                        model: 'gpt-3.5-turbo',
                        choices: [
                            {
                                delta: {
                                    content: (difyResponse.thought ? difyResponse.thought + '\n' : "")
                                        + difyResponse.observation,
                                },
                                finish_reason: null,
                            },
                        ],
                    }
                    controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(completionChunk) + '\n\n'))

                }else if (difyResponse.event === 'message_end') {
                    const completionChunk = {
                        id: difyResponse.message_id,
                        object: 'chat.completion.chunk',
                        created: difyResponse.created_at,
                        model: 'gpt-3.5-turbo',
                        choices: [
                            {
                                delta: {},
                                finish_reason: 'stop',
                            },
                        ],
                    }
                    controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify(completionChunk) + '\n\n'))
                }
            }
        }
    }

    flush(controller) {
        controller.terminate()
    }
}

async function handleRequest(request) {
    const url = new URL(request.url)
    if (url.pathname === '/v1/chat/completions') {
        const { messages, stream, ...rest } = await request.json()
        const apiKey = request.headers.get('Authorization')?.split(' ')[1]
        /**
         * You can replace the following block with your own authorization logic
         * For example, you can check if the API key is defined in the environment variables, like: DifyAPIKey = app-xxxxxxxxxxxxxxxxxx
         * if (apiKey !== DifyAPIKey) { return new Response('Unauthorized', { status: 401 })
         */
        if (!apiKey) {
            return new Response('Unauthorized', { status: 401 })
        }
        const difyRequestBody = {
            inputs: {},
            query: messages.map(message => message.content).join('\n\n'), // In this example, the content of each message is concatenated with '\n\n', replace it with the actual message content when using it in practice
            user: 'default', // In this example, 'default' is used as the user identifier, replace it with the actual user identifier when using it in practice
            conversation_id: '', // In this example, an empty string is used as the conversation ID, replace it with the actual conversation ID when using it in practice
            response_mode: stream ? 'streaming' : 'blocking',
        }
        const difyRequest = new Request('https://api.dify.ai/v1/chat-messages', {
            method: 'POST',
            body: JSON.stringify(difyRequestBody),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
        })
        let difyResponse = await fetch(difyRequest)
        if (stream) {
            difyResponse = new Response(difyResponse.body.pipeThrough(new TransformStream(new LineBreakTransformer())), difyResponse)
            difyResponse.headers.set('Content-Type', 'text/event-stream')
        } else {
            const difyResponseBody = await difyResponse.json()
            const completionResponse = {
                id: difyResponseBody.message_id,
                object: 'chat.completion',
                created: difyResponseBody.created_at,
                model: 'gpt-3.5-turbo',
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: difyResponseBody.answer,
                        },
                        finish_reason: 'stop',
                    },
                ],
            }
            difyResponse = new Response(JSON.stringify(completionResponse), difyResponse)
            difyResponse.headers.set('Content-Type', 'application/json')


        }
        // Allow cross-origin access
        difyResponse.headers.set('Access-Control-Allow-Origin', '*')
        difyResponse.headers.set('Access-Control-Allow-Methods', '*')
        difyResponse.headers.set('Access-Control-Allow-Headers', '*')
        difyResponse.headers.set('Access-Control-Allow-Credentials', 'true')

        return difyResponse
    } else {
        return new Response('Not Found', { status: 404 })
    }
}
