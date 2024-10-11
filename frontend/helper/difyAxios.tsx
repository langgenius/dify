import axios, {AxiosInstance} from "axios";

const difyAxios: AxiosInstance = axios.create({
    baseURL: process.env.DIFY_BASE_URL,
    headers: {
        Authorization: `Bearer ${process.env.DIFY_API_KEY}`
    }
})
export async function getConversations() {
    try {
        const conversationsResponse = await axios.get('/api/conversations', {
            params: {
                user: 'akshay.rajeev@agent-network.com'
            }
        });
        return conversationsResponse.data;
    } catch (error) {
        console.error(error);
    }
}
export async function getMessages(conversation_id: string) {
    try {
        const messagesResponse = await axios.get('/api/messages', {
            params: {
                conversation_id: conversation_id,
                user: 'akshay.rajeev@agent-network.com'
            }
        });
        return messagesResponse.data;
    } catch (error) {
        console.error(error);
    }
}
export default difyAxios;