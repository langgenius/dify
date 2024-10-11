import {NextRequest, NextResponse} from "next/server";
import difyAxios from "@/helper/difyAxios";

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const user = searchParams.get('user');

    if(user) {
        try {
            const conversationsResponse = await difyAxios.get('conversations', {
                params: {
                    user: user
                }
            })
            return NextResponse.json(conversationsResponse.data);
        } catch(error) {
            return NextResponse.json(error, {status: 500});
        }
    }
    return NextResponse.json({error: '認証エラー'}, {status: 401});
}