import {NextRequest, NextResponse} from "next/server";
import difyAxios from "@/helper/difyAxios";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const user = searchParams.get('user');
    const conversation_id = searchParams.get('conversation_id');

    if(user && conversation_id) {
        try {
            const messagesResponse = await difyAxios.get('messages', {
                params: {
                    user: user,
                    conversation_id: conversation_id
                }
            })
            return NextResponse.json(messagesResponse.data);
        } catch(error) {
            return NextResponse.json(error, {status: 500});
        }
    }
    return NextResponse.json({error: '認証エラー'}, {status: 401});
}