// frontend/app/routes/chat.$conversationId.tsx

// --- Core Remix Imports ---
import type { MetaFunction, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useFetcher, useParams, Link, useSubmit, useNavigate } from "@remix-run/react";
import { json, redirect } from "@remix-run/node";

// --- React Imports ---
import { useState, useEffect, useRef, useCallback } from "react";

// --- API Client Imports ---
import {
    sendChatMessage,
    uploadFile,
    getConversationDetails,
    listUploadedFiles,
    listConversations,
    createConversation,
    type ConversationInfo,
} from "~/lib/apiClient";

// --- Icons (Optional) ---
import { PaperAirplaneIcon, ArrowUpTrayIcon, DocumentTextIcon, PlusIcon, ChevronDownIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

// --- Frontend Specific Types ---
interface Message { id: string; speaker: 'user' | 'ai' | 'system'; text: string; isLoading?: boolean; sources?: Array<any>; related_doc_id?: string; }
interface UploadedFile { filename: string; doc_id: string; }
interface ConversationLoaderData { id: string; created_at: string; messages: Message[]; uploadedFiles: UploadedFile[]; }
// No longer need SidebarLoaderData type
// Keep ChatActionData type
type ChatActionResponse = { ok: true; type: 'chat'; aiResponse: { id?: string; response: string; sources?: any[] } } | { ok: false; error: string; };
type UploadActionResponse = { ok: true; type: 'upload'; uploadInfo: { doc_id?: string; filename: string; message?: string; chunks_added?: number } } | { ok: false; error: string; };
type ChatActionData = ChatActionResponse | UploadActionResponse | { ok: false; error: string; type?: never };

// --- Meta Function ---
export const meta: MetaFunction<typeof loader> = ({ data }) => {
     const titleId = data?.id ? data.id.substring(0, 8) : 'Chat';
     return [ { title: `CassaGPT Chat: ${titleId}` }, { name: "description", content: "Chat with CassaGPT!" }, ];
};

// --- Remix Loader ---
// Fetches initial data for THIS conversation page load/refresh
export async function loader({ params }: LoaderFunctionArgs) {
    const conversationId = params.conversationId;
    if (!conversationId) { return redirect("/"); }
    console.log(`Loader [${conversationId}]: Fetching initial chat data`);
    try {
        // Fetch details (which include messages) and files
        const [details, files] = await Promise.all([
             getConversationDetails(conversationId), // This endpoint MUST return messages
             listUploadedFiles(conversationId)
        ]);

        // Map messages from backend structure to frontend Message interface
        const initialMessages: Message[] = (details.messages || []).map(msg => ({ // Add default empty array
            id: msg.id,
            speaker: msg.speaker as 'user' | 'ai', // Type assertion
            text: msg.text,
            // Add any other fields if needed
        }));

        const data: ConversationLoaderData = {
            id: details.id,
            created_at: details.created_at,
            messages: initialMessages, // Pass the loaded messages
            uploadedFiles: files ?? [],
        };
        console.log(`Loader [${conversationId}]: Returning ${initialMessages.length} initial messages.`);
        return json(data);
    } catch (error: any) {
        console.error(`Loader Error for ${conversationId}:`, error);
        if (error instanceof Response && error.status === 404) { throw new Response("Conversation Not Found", { status: 404 }); }
        throw new Response(error?.message || "Error loading conversation data.", { status: error?.status || 500 });
    }
}

// --- Remix Action ---
export async function action({ request, params }: ActionFunctionArgs): Promise<Response> {
    const conversationId = params.conversationId;
    if (!conversationId) { console.error("Action Error: Missing conversation ID"); return json<ChatActionData>({ ok: false, error: "Missing conversation ID" }, { status: 400 }); }
    const formData = await request.formData();
    const intent = formData.get("intent");
    console.log(`Action [${conversationId}]: Received intent = ${intent}`);
    try {
        if (intent === "chat") {
            const query = formData.get("query");
            if (typeof query !== 'string' || !query.trim()) { console.warn(`Action [${conversationId}]: Invalid chat query received.`); return json<ChatActionData>({ ok: false, error: "Query cannot be empty" }, { status: 400 }); }
            console.log(`Action [${conversationId}]: Sending message '${query.trim()}'`);
            const response = await sendChatMessage({ query: query.trim(), conversation_id: conversationId });
            return json<ChatActionData>({ ok: true, type: 'chat', aiResponse: response });
        } else if (intent === "upload") {
            const file = formData.get("file");
            if (!(file instanceof File) || file.size === 0) { console.warn(`Action [${conversationId}]: Invalid file upload received.`); return json<ChatActionData>({ ok: false, error: "Invalid or empty file uploaded" }, { status: 400 }); }
            console.log(`Action [${conversationId}]: Uploading file '${file.name}' (Size: ${file.size})`);
            const response = await uploadFile(conversationId, file);
            return json<ChatActionData>({ ok: true, type: 'upload', uploadInfo: response });
        } else {
            console.warn(`Action [${conversationId}]: Received invalid intent: ${intent}`);
            return json<ChatActionData>({ ok: false, error: "Invalid intent specified" }, { status: 400 });
        }
    } catch (error: any) {
        console.error(`Action Error [${conversationId}] (intent: ${intent}):`, error);
        const errorMessage = error instanceof Error ? error.message : (typeof error === 'string' ? error : "An unexpected API error occurred");
        const status = error?.status || (error instanceof Response ? error.status : 500);
        return json<ChatActionData>({ ok: false, error: errorMessage }, { status: status });
    }
}


// --- Component ---
const CONVERSATION_LOAD_LIMIT = 5; // Keep this for pagination logic

export default function ChatConversation() {
    // --- Hooks ---
    const initialData = useLoaderData<typeof loader>();
    const params = useParams();
    const chatFetcher = useFetcher<ChatActionData>();
    const uploadFetcher = useFetcher<ChatActionData>();
    const submit = useSubmit();
    const navigate = useNavigate();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatInputRef = useRef<HTMLTextAreaElement>(null);

    // --- State ---
    const [messages, setMessages] = useState<Message[]>(() => initialData.messages ?? []);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(() => initialData.uploadedFiles ?? []);
    const [conversationList, setConversationList] = useState<ConversationInfo[]>([]);
    const [totalConversationsLoaded, setTotalConversationsLoaded] = useState(0);
    const [canLoadMoreConversations, setCanLoadMoreConversations] = useState(true);
    const [isLoadingList, setIsLoadingList] = useState(false); // For "Load More" button visual state
    const [inputText, setInputText] = useState("");
    const [uiError, setUiError] = useState<string | null>(null);
    const [isCreatingChat, setIsCreatingChat] = useState(false); // <-- State for New Chat button loading


    const conversationId = params.conversationId;
    if (!conversationId) { return <div className="p-4 text-red-600">Error: Conversation ID is missing.</div>; }

    // --- Loading States ---
    const isAiLoading = chatFetcher.state !== 'idle';
    const isUploading = uploadFetcher.state !== 'idle';


    // --- Handlers ---

    // Function to load conversations list using direct API call
    const loadConversations = useCallback(async (loadMore = false) => {
        if (isLoadingList) { console.log("Sidebar: Load conversations skipped, already loading."); return; }
        setIsLoadingList(true);
        setUiError(null); // Clear errors on new attempt

        const skip = loadMore ? totalConversationsLoaded : 0;
        console.log(`Sidebar: Calling API to load convos with skip=${skip}`);

        try {
            const newConvos = await listConversations(skip, CONVERSATION_LOAD_LIMIT);
            console.log(`Sidebar: Received ${newConvos.length} conversations.`);

            // Update state based on results
            // Use functional updates to ensure atomicity
            setConversationList(prevList => {
                const currentList = loadMore ? prevList : []; // Start fresh if not loading more
                const existingIds = new Set(currentList.map(c => c.id));
                const uniqueNew = newConvos.filter(nc => !existingIds.has(nc.id));
                return [...currentList, ...uniqueNew];
            });
            setTotalConversationsLoaded(prevTotal => (loadMore ? prevTotal : 0) + newConvos.length);
            setCanLoadMoreConversations(newConvos.length === CONVERSATION_LOAD_LIMIT);

        } catch (error: any) {
            console.error("Sidebar: Error loading conversation list:", error);
            setUiError(`Failed to load conversation list: ${error.message || "Unknown error"}`);
            setCanLoadMoreConversations(false);
        } finally {
            setIsLoadingList(false); // Reset button loading state
        }
    }, [totalConversationsLoaded, isLoadingList]); // Dependencies: count for skip, loading flag


    // Handler for "Load More" conversations button click
    const handleLoadMoreConversations = useCallback(() => {
        console.log("handleLoadMoreConversations triggered.");
        // Check button loading state
        if (!isLoadingList) {
            loadConversations(true);
        }
    }, [isLoadingList, loadConversations]);


    // Handle text input submission - **MODIFIED FOR OPTIMISTIC UI**
    const handleSendMessage = useCallback(() => {
        // No event needed here as it's triggered by button onClick or Enter key handler
        const query = inputText.trim();
        console.log(`handleSendMessage called. Query: "${query}", Fetcher state: ${chatFetcher.state}, Convo ID: ${conversationId}`);
        if (!query || chatFetcher.state !== 'idle' || !conversationId) {
            console.log("handleSendMessage: Submission prevented.");
            return;
        }

        // 1. Optimistic UI Update: Add user message immediately
        const optimisticId = `optimistic-user-${Date.now()}`;
        setMessages(prev => [...prev, {
            id: optimisticId, // Use temporary ID
            speaker: 'user',
            text: query,
            isLoading: true // Mark as loading/optimistic
        }]);
        setInputText(""); // Clear input field
        setUiError(null); // Clear previous errors

        // 2. Submit data using the chatFetcher
        console.log("handleSendMessage: Submitting chat fetcher...");
        chatFetcher.submit(
            { intent: "chat", query }, // Form data payload
            { method: "post", action: `/chat/${conversationId}` } // Target action
        );
         // Focus input after sending
         setTimeout(() => chatInputRef.current?.focus(), 0);

    }, [inputText, chatFetcher, conversationId]); // Include necessary dependencies


    // Handler for file input change and triggering uploadFetcher
    const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        console.log("handleFileChange triggered");
        const file = event.target.files?.[0];
        if(event.target) event.target.value = ''; // Reset file input
        if (!file) { console.log("handleFileChange: No file selected."); return; }
        if (!conversationId) { console.error("handleFileChange: No conversation ID."); setUiError("Cannot upload file: No active conversation."); return; }
        if (isUploading) { console.log("handleFileChange: Upload already in progress."); setUiError("Please wait for the current upload to finish."); return; }
        console.log(`handleFileChange: Submitting upload fetcher for ${file.name}...`);
        const formData = new FormData();
        formData.append("intent", "upload");
        formData.append("file", file);
        try {
            uploadFetcher.submit(formData, { method: "post", action: `/chat/${conversationId}`, encType: "multipart/form-data" });
            setUiError(null);
        } catch (error) { console.error("Error calling uploadFetcher.submit:", error); setUiError("Failed to initiate file upload."); }
    }, [uploadFetcher, conversationId, isUploading]);


    // --- MODIFIED: handleNewChat uses apiClient and navigate ---
    const handleNewChat = useCallback(async () => {
        console.log("handleNewChat triggered.");
        if (isCreatingChat) return; // Prevent double clicks

        setIsCreatingChat(true); // Set loading state for the button
        setUiError(null); // Clear previous errors

        try {
            console.log("Calling createConversation API client function...");
            // Directly call the API client function
            const newConv = await createConversation(); // Hits POST /chat/conversations

            if (newConv?.id) {
                console.log(`New conversation created: ${newConv.id}. Reloading list...`);
                // Call loadConversations to refresh conversations list
                await loadConversations(false);
                console.log("Navigation to new conversation...");
                // Navigate to the new chat page upon success
                navigate(`/chat/${newConv.id}`);
            } else {
                throw new Error("API did not return a valid conversation ID.");
            }
        } catch (error: any) {
            console.error("Failed to create new conversation via API:", error);
            setUiError(`Failed to create new chat: ${error.message || "Unknown error"}`);
        } finally {
            setIsCreatingChat(false); // Reset loading state
        }
    }, [navigate, isCreatingChat, loadConversations]);



    // Handler for the visible Upload button
    const handleUploadButtonClick = useCallback(() => {
        console.log("handleUploadButtonClick triggered.");
        if(fileInputRef.current) { fileInputRef.current.click(); }
        else { console.error("handleUploadButtonClick: fileInputRef is not available."); setUiError("File upload input not ready."); }
    }, []);


    // --- Effects ---

    // --- **NEW Effect: Reset state when conversationId changes** ---
    useEffect(() => {
        console.log(`Effect: conversationId changed to ${conversationId}. Resetting state.`);
        // Reset messages and files based on the potentially new initialData from the loader
        setMessages(initialData.messages ?? []);
        setUploadedFiles(initialData.uploadedFiles ?? []);
        // Reset other relevant states if necessary (e.g., clear input, errors)
        setInputText("");
        setUiError(null);
        // Optionally, clear fetcher states if needed, though Remix might handle this
        // chatFetcher.data = undefined;
        // uploadFetcher.data = undefined;

        // Re-fetch conversation list for the sidebar? Or assume it's relatively static?
        // Let's keep the initial load logic separate for now.

    // Dependency: Run this effect *only* when the conversationId from the URL changes
    // or when the initialData reference itself changes (meaning loader re-ran)
    }, [conversationId, initialData]);
    // --- End New Effect ---

    // Initial conversation list load
    useEffect(() => {
        console.log("Effect: Initial conversation load check.");
        // Load only if the list is empty and not already loading
        if (conversationList.length === 0 && !isLoadingList) {
             console.log("Effect: Calling loadConversations(false) for initial load.");
             loadConversations(false);
        }
    // This effect now correctly triggers the *direct* API call via loadConversations
    }, [conversationList.length, isLoadingList, loadConversations]);


    // Handle ChatFetcher action response (AI message or error)
    // Process ChatFetcher action response - **MODIFIED TO HANDLE OPTIMISTIC UI**
    useEffect(() => { if (chatFetcher.state === 'idle') { setMessages(prev => prev.filter(m => !(m.isLoading && m.speaker === 'user'))); if (chatFetcher.data) { const data = chatFetcher.data; if (data.ok && data.type === 'chat') { const aiMsg = data.aiResponse; if (aiMsg?.response) { setMessages(prev => { if (!prev.some(m => (aiMsg.id && m.id === aiMsg.id) || (m.text === aiMsg.response && m.speaker === 'ai'))) { return [...prev, { id: aiMsg.id || crypto.randomUUID(), speaker: 'ai', text: aiMsg.response, sources: aiMsg.sources }]; } return prev; }); setUiError(null); } else { console.warn("Chat Effect: Success but no AI text."); } } else if (!data.ok) { console.error("Chat Effect: Action failed.", data.error); setUiError(data.error || "Failed to send message."); } } } }, [chatFetcher.state, chatFetcher.data]);


    // Handle UploadFetcher action response - REMOVE system message add
    useEffect(() => {
    if (uploadFetcher.state === 'idle' && uploadFetcher.data) {
        const data = uploadFetcher.data;
        if (data.ok && data.type === 'upload') {
            const info = data.uploadInfo;
            const docId = info?.doc_id;
            const filename = info?.filename;
            console.log("Upload Effect: Processing success", info);

            if (filename && docId) {
                setUploadedFiles(prev => {
                    // Only add if not already present
                    if (prev.some(f => f.doc_id === docId)) {
                        return prev;
                    }
                    return [...prev, { filename, doc_id: docId }];
                });
            }
            setUiError(null);
        } else if (!data.ok) {
            console.error("Upload Effect: Action failed.", data.error);
            setUiError(`Upload Error: ${data.error || "Unknown upload error."}`);
        }
    }
}, [uploadFetcher.state, uploadFetcher.data]);


    // Scroll messages to bottom
    useEffect(() => {
        if (messages.length > 0) {
            const timer = setTimeout(() => {
                console.log("Effect: Scroll to bottom triggered.");
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [messages]);


    // --- JSX ---
    return (
        <div className="flex h-screen bg-gray-100 antialiased text-gray-900">
            {/* Sidebar */}
            <aside className="w-64 border-r border-gray-200 bg-white flex flex-col p-4 overflow-y-auto flex-shrink-0">
                {/* ... Sidebar content ... */}
                 <button type="button" onClick={handleNewChat} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 mb-4 transition-colors duration-150"> <PlusIcon className="h-5 w-5" aria-hidden="true" /> New Chat </button>
                <div className="mb-4"> <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">Uploaded Files</h3> {uploadedFiles.length === 0 ? ( <p className="text-sm text-gray-400 italic px-1">(No files uploaded)</p> ) : ( <ul className="space-y-1 max-h-40 overflow-y-auto"> {uploadedFiles.map((file) => ( <li key={file.doc_id} title={file.filename} className="flex items-center gap-2 text-sm text-gray-700 truncate px-1 py-0.5"> <DocumentTextIcon className="h-4 w-4 text-gray-400 flex-shrink-0" aria-hidden="true" /> <span className="truncate">{file.filename}</span> </li> ))} </ul> )} </div>
                 <hr className="my-2 border-gray-200"/>
                <div className="flex-grow flex flex-col min-h-0">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex-shrink-0 px-1">Conversations</h3>
                    {isLoadingList && conversationList.length === 0 ? ( <p className="text-sm text-gray-400 italic flex-shrink-0 px-1">Loading chats...</p> ) : conversationList.length === 0 && !isLoadingList ? ( <p className="text-sm text-gray-400 italic flex-shrink-0 px-1">(No past chats)</p> ) : null}
                     {conversationList.length > 0 && ( <ul className="space-y-1 overflow-y-auto flex-grow min-h-0 mb-2"> {conversationList.map(conv => ( <li key={conv.id}> <Link to={`/chat/${conv.id}`} className={`block px-2 py-1 rounded text-sm truncate transition-colors duration-150 ${ conv.id === conversationId ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900' }`} title={`Chat from ${new Date(conv.created_at).toLocaleString()}`} prefetch="intent"> Chat {conv.id.substring(0, 8)}... </Link> </li> ))} </ul> )}
                    {canLoadMoreConversations && conversationList.length > 0 && ( <button type="button" onClick={handleLoadMoreConversations} disabled={isLoadingList} className="mt-auto flex-shrink-0 w-full flex items-center justify-center gap-1 px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150"> {isLoadingList ? (<> <ArrowPathIcon className="animate-spin h-3 w-3 mr-1"/> Loading... </>) : (<> Load More <ChevronDownIcon className="h-3 w-3 ml-1"/> </>)} </button> )}
                </div>
            </aside>

            {/* Main Chat Area */}
            <main className="flex-grow flex flex-col bg-white">
                {/* Header */}
                <header className="p-4 border-b border-gray-200 text-center bg-gray-50 flex-shrink-0"> <h1 className="text-xl font-semibold text-gray-800">CassaGPT Demo</h1> <p className="text-xs text-gray-500 mt-1">Chat ID: {conversationId}</p> </header>

                {/* Message List */}
                <div className="flex-grow p-4 overflow-y-auto space-y-4 bg-white">
                    {uiError && <div className="p-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700" role="alert">{uiError} <button type="button" onClick={() => setUiError(null)} className="float-right font-bold text-red-800 hover:text-red-600 text-lg leading-none">×</button> </div>}
                    {/* Render messages, including optimistic ones */}
                    {messages.map((msg) => (
                       <div key={msg.id} className={`flex w-full ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                         <div className={`flex flex-col ${msg.speaker === 'user' ? 'items-end' : 'items-start'}`}>
                           <div className={`p-3 rounded-lg whitespace-pre-wrap break-words shadow-sm ${
                                msg.speaker === 'user'
                                    ? 'bg-blue-500 text-white'
                                    : (msg.speaker === 'system'
                                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                                        : 'bg-gray-100 text-gray-800 border border-gray-200')
                            } ${msg.isLoading && msg.speaker === 'user' ? 'opacity-70 animate-pulse' : ''}`}>
                                {msg.text}
                           </div>
                           {msg.speaker === 'ai' && msg.sources && msg.sources.length > 0 && (
                                <div className="mt-1 text-xs text-gray-500 opacity-80 px-1">
                                    Sources: {msg.sources.map((s, index) => (
                                        <span key={index} title={s?.filename || 'Unknown Source'}>
                                             {s?.filename?.split('/').pop() || s?.doc_id?.substring(0, 6) || 'history'}
                                             {index < msg.sources!.length - 1 ? ', ' : ''}
                                         </span>
                                    ))}
                                </div>
                           )}
                         </div>
                       </div>
                    ))}
                    <div ref={messagesEndRef} /> {/* Scroll Anchor */}
                </div>

                {/* Input Area */}
                <div className="p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
                    <div className="flex items-end gap-2">
                        {/* File Upload Button */}
                        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif" disabled={isUploading || !conversationId} />
                        <button type="button" onClick={handleUploadButtonClick} disabled={isUploading || !conversationId} title={isUploading ? "Uploading..." : "Upload File"} className="flex-shrink-0 p-2 rounded-md text-gray-500 bg-white border border-gray-300 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"> {isUploading ? ( <ArrowPathIcon className="h-5 w-5 animate-spin text-blue-500" /> ) : ( <ArrowUpTrayIcon className="h-5 w-5" /> )} </button>

                        {/* Chat Input Form */}
                        {/* Use regular Form, submit handled by Enter or Button */}
                        <Form method="post" action={`/chat/${conversationId}`} onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex-grow flex gap-2 items-end">
                            <input type="hidden" name="intent" value="chat" />
                            <textarea ref={chatInputRef} name="query" rows={1} className="flex-grow block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed resize-none leading-tight" placeholder={isAiLoading ? "AI is thinking..." : "Type your message..."} value={inputText} onChange={(e) => { setInputText(e.target.value); e.target.style.height = 'auto'; const maxHeight = 5 * 24; e.target.style.height = `${Math.min(e.target.scrollHeight, maxHeight)}px`; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isAiLoading && !isUploading && inputText.trim()) { e.preventDefault(); console.log("Enter pressed, calling handleSendMessage"); handleSendMessage(); e.currentTarget.style.height = 'auto'; /* Reset height after send */ } }} disabled={isAiLoading || isUploading || !conversationId} />
                            <button type="submit" className="flex-shrink-0 inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 h-[40px]" disabled={isAiLoading || isUploading || !inputText.trim() || !conversationId || chatFetcher.state !== 'idle'}> {isAiLoading ? (<ArrowPathIcon className="animate-spin h-5 w-5"/>) : (<PaperAirplaneIcon className="h-5 w-5"/>) } <span className="ml-2 hidden sm:inline">{isAiLoading ? "Sending..." : "Send"}</span> </button>
                        </Form>
                    </div>
                     {uploadFetcher.state === 'idle' && uploadFetcher.data && !uploadFetcher.data.ok && ( <p className="text-xs text-red-600 mt-1 ml-12">{`Upload failed: ${uploadFetcher.data.error}`}</p> )}
                 </div>
            </main>
        </div>
      );
}