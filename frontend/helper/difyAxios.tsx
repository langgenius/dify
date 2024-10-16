import axios, {AxiosInstance} from "axios";

const difyAxios: AxiosInstance = axios.create({
    baseURL: process.env.DIFY_BASE_URL,
    headers: {
        Authorization: `Bearer ${process.env.DIFY_API_KEY}`
    }
})
export async function getConversations(email: string) {
    try {
        const conversationsResponse = await axios.get('api/conversations', {
            baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
            params: {
                user: email
            }
        });
        return conversationsResponse.data;
    } catch (error) {
        console.error(error);
    }
}
export async function getMessages(conversation_id: string, email: string) {
    try {
        const messagesResponse = await axios.get('/api/messages', {
            baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
            params: {
                conversation_id: conversation_id,
                user: email
            }
        });
        return messagesResponse.data;
    } catch (error) {
        console.error(error);
    }
}
export default difyAxios;