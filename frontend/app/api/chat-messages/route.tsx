import {NextRequest, NextResponse} from "next/server";

export async function POST(request: NextRequest) {
    const params = await request.json();
    const user = params.user;
    const query = params.query;
    const ai_name = params.ai_name;
    const conversation_id = params.conversation_id;

    if(user) {
        const difyResponse = await fetch(`${process.env.DIFY_BASE_URL}/chat-messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${process.env.DIFY_API_KEY}`
            },
            body: JSON.stringify({
                user: user,
                query: query,
                response_mode: "streaming",
                conversation_id: conversation_id,
                inputs: {
                    ai_name: ai_name
                }
            }),
        });

        if (!difyResponse.body) {
            return NextResponse.error();
        }

        return new Response(difyResponse.body, {
            headers: { 'Content-Type': 'text/event-stream' },
        });
    }
    return NextResponse.json({error: '認証エラー'}, {status: 401});
}