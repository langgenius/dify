import {NextRequest, NextResponse} from "next/server";
import {prisma} from "@/helper/prisma";

export async function POST(request: NextRequest) {
    const params = await request.json();
    const ai_name = params.ai_name ?? null;
    const conversation_id = params.conversation_id ?? null;

    if(ai_name && conversation_id) {
        await prisma.conversations.update({
            where: {
                id: conversation_id
            },
            data: {
                inputs: {
                    ai_name: ai_name
                }
            }
        });
        return NextResponse.json({status: true});
    }
    return NextResponse.json({status: false});
}