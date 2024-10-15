'use client'

import {ListBox} from "primereact/listbox";
import {KeyboardEvent, useEffect, useRef, useState} from "react";
import {InputText} from "primereact/inputtext";
import {DataScroller} from "primereact/datascroller";
import {Message} from "primereact/message";
import {Button} from "primereact/button";
import {ProgressSpinner} from "primereact/progressspinner";
import {Menubar} from "primereact/menubar";
import {RadioButton} from "primereact/radiobutton";
import rehypeHighlight from "rehype-highlight";
import ReactMarkdown from 'react-markdown';
import React from 'react'
import {getConversations, getMessages} from "@/helper/difyAxios";
import axios from "axios";

export default function View({email}: {email: string}) {
    const [conversations, setConversations] = useState<{ data: [] }>({ data: [] });
    const [selectedConversation, setSelectedConversation] = useState<{ id: string } | null>(null);
    const [messages, setMessages] = useState<any>({data: []});
    const [query, setQuery] = useState('');
    const dataScrollerContainerRef = useRef<HTMLDivElement>(null);
    const [loading, setLoading] = useState(false);
    const [ai_name, set_ai_name] = useState('ChatGPT')
    const [isComposing, setIsComposing] = useState(false);
    const [streamingMessage, setStreamingMessage] = useState<string>('');
    async function handleSubmit(event: KeyboardEvent<HTMLInputElement>) {
        if(event.key == 'Enter' && !isComposing) {
            await sendChatMessage()
        }
    }

    async function sendChatMessage() {
        setQuery('');
        messages.data.push({query: query, answer: ''});
        let lastMessage = messages.data[messages.data.length - 1] ?? null;
        setLoading(true);
        let firstRun = true;
        const fetchStream = async () => {
            const response = await fetch('/api/chat-messages', {
                method: 'POST',
                body: JSON.stringify({
                    query: query,
                    conversation_id: selectedConversation?.id,
                    user: email,
                    ai_name: ai_name
                })
            });

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                let done = false;
                while (!done) {
                    const {value, done: readerDone} = await reader.read();
                    done = readerDone;
                    const chunk = decoder.decode(value, {stream: true});

                    // Split by newline to handle multiple events and trim the "data: " part
                    for (const line of chunk.split('\n')) {
                        const index = chunk.split('\n').indexOf(line);
                        const trimmedLine = line.trim();

                        // Ensure line starts with 'data:' and extract the JSON part
                        if (trimmedLine.startsWith('data: ')) {
                            const jsonData = trimmedLine.replace('data: ', '');

                            try {
                                const event = JSON.parse(jsonData);
                                if (event && event.answer) {
                                    lastMessage.conversation_id = event.conversation_id;
                                    lastMessage.id = event.message_id;
                                    lastMessage.answer += event.answer;
                                    setMessages((prevMessages: any) => {
                                        const newData = [...prevMessages.data];
                                        return { data: newData };
                                    });
                                    setStreamingMessage((prevMessage) => prevMessage + event.answer);
                                    if(firstRun) {
                                        setLoading(false);
                                        const newConversations = await getConversations(email);
                                        const newConversation = newConversations?.data.find((item: any) => item.id === event.conversation_id);
                                        setConversations(newConversations);
                                        setSelectedConversation(newConversation);
                                        firstRun = false;
                                    }
                                }
                            } catch (err) {
                                console.error('Error parsing stream data:', err);
                            }
                        }
                    }
                }
            }
            setLoading(false);
            setStreamingMessage('');
        };
        await fetchStream();
    }

    useEffect(() => {
        if(loading) {
            setTimeout(() => {
                if(dataScrollerContainerRef.current) {
                    dataScrollerContainerRef.current.scrollTop = dataScrollerContainerRef.current.scrollHeight;
                }
            }, 200);
        }
    }, [loading, streamingMessage]);

    const messageTemplate = (message: any) => {
        return <div className={'flex justify-content-center'}>
            <div className={'col-8'}>
                <div className={'text-right'}>
                    <Message severity={'success'} content={message.query}></Message>
                </div>
                <ReactMarkdown rehypePlugins={[rehypeHighlight]}>
                    {message?.answer ?? ''}
                </ReactMarkdown>
            </div>
        </div>
    }

    useEffect(() => {
        getConversations(email).then(response => {
            setConversations(response);
        });
    }, []);

    async function changeAI(new_ai_name: string) {
        if(selectedConversation) {
            try {
                await axios.post('/api/change-ai', {
                    ai_name: new_ai_name ?? null,
                    conversation_id: selectedConversation?.id ?? null
                });
            } catch (error) {
                console.error(error)
                return;
            }
        }
        set_ai_name(new_ai_name);
    }
    const aiNamesMenuItems = (message: any) => {
        return <div className="flex flex-wrap gap-3">
            <div className="flex align-items-center">
                <RadioButton inputId="ChatGPT" name="ai_name" value="ChatGPT"
                             onChange={(e) => changeAI(e.value)}
                             checked={ai_name === 'ChatGPT'}/>
                <label htmlFor="ChatGPT" className="ml-2">ChatGPT</label>
            </div>
            <div className="flex align-items-center">
                <RadioButton inputId="Claude" name="ai_name" value="Claude"
                             onChange={(e) => changeAI(e.value)}
                             checked={ai_name === 'Claude'}/>
                <label htmlFor="Claude" className="ml-2">Claude</label>
            </div>
        </div>
    }

    function createNewChat() {
        set_ai_name('ChatGPT');
        setMessages({data: []});
        setSelectedConversation(null);
    }

    const companyLogo = () => {
        return <span className={'flex flex-wrap align-items-center'}>
            <img src={'/user/logo1.png'} alt={'logo1'} className={'ml-2'} width={'45px'}/>
            <img src={'/user/logo2.png'} alt={'logo2'} className={'ml-2'} width={'110px'}/>
        </span>
    }

    async function onChangeSelectConversation(newConversation: any) {
        const newMessages = await getMessages(newConversation.id, email);
        setMessages(newMessages);
        setSelectedConversation(newConversation);
        set_ai_name(newConversation?.inputs?.ai_name ?? 'ChatGPT');
    }

    return (
        <div className="flex flex-column overflow-hidden" style={{height: '100vh'}}>
            <Menubar style={{ backgroundColor: "white" }} start={companyLogo} end={aiNamesMenuItems} className={'w-full'}/>
            <div className="flex flex-row flex-grow-1 overflow-hidden">
                <div className="col-2 flex flex-column">
                    <Button
                        size={'small'}
                        style={{ color: 'var(--primary-color-text)' }}
                        onClick={createNewChat}
                        className={'w-full'}
                        label={'New Chat'}
                        outlined
                    ></Button>
                    <ListBox
                        value={selectedConversation}
                        onChange={(e) => onChangeSelectConversation(e.value)}
                        options={conversations?.data}
                        optionLabel="name"
                        className={'flex-grow-1 my-2 overflow-y-auto'}
                    />
                </div>
                <div className="col-10 flex flex-column">
                    <div ref={dataScrollerContainerRef} className="flex-grow-1 overflow-y-auto">
                        <DataScroller
                            value={messages.data}
                            rows={100}
                            itemTemplate={messageTemplate}
                        />
                        <div className={'flex justify-content-center'}>
                            <div className={'col-8'}>
                                { loading && <ProgressSpinner/> }
                            </div>
                        </div>
                    </div>
                    <div className="flex py-2">
                        <InputText
                            disabled={loading}
                            className="flex-grow-1"
                            value={query}
                            onKeyDown={(e) => handleSubmit(e)}
                            onChange={(e) => setQuery(e.target.value)}
                            onCompositionStart={() => setIsComposing(true)}
                            onCompositionEnd={() => setIsComposing(false)}
                        />
                        <Button
                            rounded
                            style={{background: 'var(--primary-color)', borderColor: 'var(--primary-color)'}}
                            disabled={loading}
                            onClick={sendChatMessage}
                            className={'ml-2'} icon="pi pi-send"
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
