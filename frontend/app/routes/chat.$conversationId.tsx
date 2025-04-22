// frontend/app/routes/chat.$conversationId.tsx

// --- Core Remix Imports ---
import type { MetaFunction, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useFetcher, useParams, Link, useNavigate, useRouteError, isRouteErrorResponse } from "@remix-run/react"; // Removed useSubmit
import { redirect } from "@remix-run/node";

// --- React Imports ---
import { useState, useEffect, useRef, useCallback } from "react";
import SafeThemeToggle from "~/components/SafeThemeToggle";

// --- API Client Imports ---
// Import corrected and necessary types/functions
import {
    sendChatMessage,
    uploadFileToSession,
    getConversationDetails,
    listSessionUploadedFiles,
    listConversations,
    createConversation,
    listKnowledgeBases,
    type ConversationInfo, // Basic info type (now includes nested KB)
    type ConversationDetail, // Detailed info type (includes nested KB)
    type KnowledgeBaseInfo, // KB info type
    type SessionUploadResponsePayload // Session upload response type
} from "~/lib/apiClient"; // Ensure path is correct

// --- Icons (Optional) ---
import {
    PaperAirplaneIcon,
    PaperClipIcon, // Changed from ArrowUpTrayIcon
    DocumentTextIcon,
    PlusIcon,
    ChevronDownIcon,
    ArrowPathIcon,
    HomeIcon, // Added
    CircleStackIcon, // Added
    CpuChipIcon, // Added for model display
    ExclamationTriangleIcon // Added for error boundary
} from '@heroicons/react/24/outline';

// --- Frontend Specific Types ---
interface Message { id: string; speaker: 'user' | 'ai' | 'system'; text: string; isLoading?: boolean; sources?: Array<any>; related_doc_id?: string; created_at: string; } // Message type for chat messages
interface UploadedFile { filename: string; doc_id: string; } // For session uploads list

// Loader Data type uses ConversationDetail from apiClient
// It already includes the nested knowledge_base object
interface ConversationLoaderData extends ConversationDetail {
    uploadedFiles: UploadedFile[]; // Add session files list
    messages: Message[]; // Ensure this field holds the mapped Message type
}

// Action response types
type ChatActionResponse = { ok: true; type: 'chat'; aiResponse: { id?: string; response: string; sources?: any[] } } | { ok: false; error: string; };
type UploadActionResponse = { ok: true; type: 'upload'; uploadInfo: SessionUploadResponsePayload } | { ok: false; error: string; };
type ChatActionData = ChatActionResponse | UploadActionResponse | { ok: false; error: string; type?: never };


// --- Meta Function ---
export const meta: MetaFunction<typeof loader> = ({ data }) => {
     const conversationData = data as ConversationLoaderData | undefined;
     const titleId = conversationData?.id ? conversationData.id.substring(0, 8) : 'Chat';
     return [ { title: `CassaGPT Chat: ${titleId}` }, { name: "description", content: "Chat with CassaGPT!" }, ];
};

// --- Remix Loader ---
// Fetches initial data including nested KB info
export async function loader({ params }: LoaderFunctionArgs) {
    const conversationId = params.conversationId;
    if (!conversationId) { return redirect("/"); }
    console.log(`Loader [${conversationId}]: Fetching initial chat data (incl. KB)`);
    try {
        const [details, sessionFiles] = await Promise.all([
             getConversationDetails(conversationId), // Returns ConversationDetail (with nested KB)
             listSessionUploadedFiles(conversationId)
        ]);

        const initialMessages: Message[] = (details.messages || []).map(msg => ({
            id: msg.id,
            speaker: msg.speaker as 'user' | 'ai' | 'system',
            text: msg.text,
            isLoading: false,
            created_at: msg.created_at,
        }));

        const uploadedSessionFiles: UploadedFile[] = (sessionFiles || []).map(file => ({
            filename: file.filename,
            doc_id: file.doc_id,
        }));

        // Construct loader data using the ConversationLoaderData interface
        const data: ConversationLoaderData = {
            ...details, // Spread details from ConversationDetail
            messages: initialMessages, // Override with mapped messages
            uploadedFiles: uploadedSessionFiles,
        };
        console.log(`Loader [${conversationId}]: Returning ${initialMessages.length} messages. Linked KB: ${data.knowledge_base?.name ?? 'None'}.`);
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    } catch (error: any) {
        console.error(`Loader Error for ${conversationId}:`, error);
        if (error instanceof Response && error.status === 404) { throw new Response("Conversation Not Found", { status: 404 }); }
        const detail = (error instanceof Response ? (await error.text()) : error?.message) || "Error loading conversation data.";
        throw new Response(detail, { status: error?.status || 500 });
    }
}

// --- Remix Action ---
// (Action remains the same - uses uploadFileToSession correctly now)
export async function action({ request, params }: ActionFunctionArgs): Promise<Response> {
    const conversationId = params.conversationId;
    if (!conversationId) { return new Response(JSON.stringify({ ok: false, error: "Missing conversation ID" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
    const formData = await request.formData();
    const intent = formData.get("intent");
    console.log(`Action [${conversationId}]: Received intent = ${intent}`);
    try {
        if (intent === "chat") {
            const query = formData.get("query");
            if (typeof query !== 'string' || !query.trim()) { return new Response(JSON.stringify({ ok: false, error: "Query cannot be empty" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
            const response = await sendChatMessage({ query: query.trim(), conversation_id: conversationId });
            return new Response(JSON.stringify({ ok: true, type: 'chat', aiResponse: response }), { headers: { 'Content-Type': 'application/json' } });
        } else if (intent === "upload") {
            const file = formData.get("file");
            if (!(file instanceof File) || file.size === 0) { return new Response(JSON.stringify({ ok: false, error: "Invalid or empty file uploaded" }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
            const response = await uploadFileToSession(conversationId, file);
            return new Response(JSON.stringify({ ok: true, type: 'upload', uploadInfo: response }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ ok: false, error: "Invalid intent specified" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
    } catch (error: any) {
         console.error(`Action Error [${conversationId}] (intent: ${intent}):`, error);
         const errorMessage = (error instanceof Response ? (await error.text()) : error?.message) || "An unexpected API error occurred";
         const status = error?.status || (error instanceof Response ? error.status : 500);
         return new Response(JSON.stringify({ ok: false, error: errorMessage }), { status: status, headers: { 'Content-Type': 'application/json' } });
    }
}


// --- Component ---
export const CONVERSATION_LOAD_LIMIT = 5;

export default function ChatConversation() {
    const loaderData = useLoaderData<typeof loader>(); // Use loader data which includes KB info
    const params = useParams();
    const chatFetcher = useFetcher<ChatActionData>();
    const uploadFetcher = useFetcher<ChatActionData>(); // For session uploads
    const navigate = useNavigate();
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatInputRef = useRef<HTMLTextAreaElement>(null);

    // State initialization
    const [messages, setMessages] = useState<Message[]>(() => loaderData.messages ?? []);
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>(() => loaderData.uploadedFiles ?? []); // Session files
    const [conversationList, setConversationList] = useState<ConversationInfo[]>([]); // Sidebar convo list
    const [totalConversationsLoaded, setTotalConversationsLoaded] = useState(0);
    const [canLoadMoreConversations, setCanLoadMoreConversations] = useState(true);
    const [isLoadingList, setIsLoadingList] = useState(false);
    const [allKnowledgeBases, setAllKnowledgeBases] = useState<KnowledgeBaseInfo[]>([]);
    const [kbsLoaded, setKbsLoaded] = useState<boolean>(false);
    const [isLoadingKBs, setIsLoadingKBs] = useState(false); // Sidebar KBs loading
    const [inputText, setInputText] = useState("");
    const [uiError, setUiError] = useState<string | null>(null);
    const [isCreatingChat, setIsCreatingChat] = useState(false);
    const [selectedKbForNewChat, setSelectedKbForNewChat] = useState<string>("");
    const [selectedModel, setSelectedModel] = useState<string>("meta-llama/Llama-3.3-70B-Instruct-Turbo-Free");


    const conversationId = params.conversationId;
    if (!conversationId) { return <div className="p-4 text-red-600">Error: Conversation ID is missing.</div>; }

    const isAiLoading = chatFetcher.state !== 'idle';

    // --- Handlers ---
    const loadConversations = useCallback(async (loadMore = false) => {
        if (isLoadingList) return; setIsLoadingList(true); setUiError(null);
        const skip = loadMore ? totalConversationsLoaded : 0;
        try {
            // listConversations now returns ConversationInfo including nested KB
            const newConvos = await listConversations(skip, CONVERSATION_LOAD_LIMIT);
            setConversationList(prevList => {
                const currentList = loadMore ? prevList : [];
                const existingIds = new Set(currentList.map(c => c.id));
                const uniqueNew = newConvos.filter(nc => !existingIds.has(nc.id));
                return [...currentList, ...uniqueNew];
            });
            setTotalConversationsLoaded(prevTotal => (loadMore ? prevTotal : 0) + newConvos.length);
            setCanLoadMoreConversations(newConvos.length === CONVERSATION_LOAD_LIMIT);
        } catch (error: any) { setUiError(`Failed load convos: ${error.message || "Err"}`); setCanLoadMoreConversations(false); }
        finally { setIsLoadingList(false); }
    }, [totalConversationsLoaded, isLoadingList]);

    const handleLoadMoreConversations = useCallback(() => { if (!isLoadingList) loadConversations(true); }, [isLoadingList, loadConversations]);
    const handleSendMessage = useCallback(() => { /* ... same optimistic send ... */
        const query = inputText.trim(); if (!query || chatFetcher.state !== 'idle' || !conversationId) return;
        const optimisticId = `optimistic-user-${Date.now()}`;
        setMessages(prev => [...prev, { id: optimisticId, speaker: 'user', text: query, isLoading: true, created_at: new Date().toISOString() }]);
        setInputText(""); setUiError(null);
        chatFetcher.submit({ intent: "chat", query }, { method: "post", action: `/chat/${conversationId}` });
        setTimeout(() => chatInputRef.current?.focus(), 0);
    }, [inputText, chatFetcher, conversationId]);

    const handleNewChat = useCallback(async () => {
        if (isCreatingChat) return;
        setIsCreatingChat(true);
        setUiError(null);
        try {
          // Pass selectedKbForNewChat if set, else null
          // Use the selected model from state
          console.log(`handleNewChat: Creating new conversation with model: ${selectedModel}`);
          const newConv = await createConversation(selectedKbForNewChat || null, selectedModel);
          if (newConv?.id) {
            await loadConversations(false);
            navigate(`/chat/${newConv.id}`);
          } else {
            throw new Error("API did not return a valid conversation ID.");
          }
        } catch (error: any) {
          setUiError(`Failed new chat: ${error.message || "Err"}`);
        } finally {
          setIsCreatingChat(false);
          selectedKbForNewChat && setSelectedKbForNewChat(""); // Reset selected KB for new chat
        }
      }, [navigate, isCreatingChat, loadConversations, selectedKbForNewChat, selectedModel]);

    const handleUploadButtonClick = useCallback(() => { if(fileInputRef.current) fileInputRef.current.click(); }, []);
    // State for direct Excel uploads
    const [manualUploading, setManualUploading] = useState<boolean>(false);
    const isUploading = uploadFetcher.state !== 'idle' || manualUploading;

    const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if(event.target) event.target.value = '';
        if (!file || !conversationId || isUploading) return;

        // Check if this is an Excel file
        const isExcelFile = /\.(xlsx|xls)$/i.test(file.name);
        console.log(`Chat file upload: ${file.name}, isExcel: ${isExcelFile}`);

        // For Excel files, use direct API call to avoid turbo-stream error
        if (isExcelFile) {
            try {
                setManualUploading(true);
                setUiError(null);

                // Call the API directly
                const result = await uploadFileToSession(conversationId, file);

                console.log(`Direct upload successful for Excel file in chat: ${result.filename}`);

                // Set a flag in sessionStorage to handle potential errors on reload
                sessionStorage.setItem('chatExcelUploadSuccess', 'true');

                // Update the UI with the new file
                if (result.filename && result.doc_id) {
                    setUploadedFiles(prev =>
                        prev.some(f => f.doc_id === result.doc_id)
                            ? prev
                            : [...prev, { filename: result.filename, doc_id: result.doc_id || '' }]
                    );

                    // Add a system message to show the upload was successful
                    setMessages(prev => [
                        ...prev,
                        {
                            id: crypto.randomUUID(),
                            speaker: 'system',
                            text: `File uploaded: ${result.filename}`,
                            created_at: new Date().toISOString()
                        }
                    ]);
                }
            } catch (error) {
                console.error("Direct Excel file upload in chat failed:", error);
                setUiError(`Failed to upload Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } finally {
                setManualUploading(false);
            }
        } else {
            // For non-Excel files, use the normal Remix form submission
            const formData = new FormData();
            formData.append("intent", "upload");
            formData.append("file", file);

            try {
                uploadFetcher.submit(formData, {
                    method: "post",
                    action: `/chat/${conversationId}`,
                    encType: "multipart/form-data"
                });
                setUiError(null);
            } catch (error) {
                setUiError("Failed to initiate session file upload.");
            }
        }
    }, [uploadFetcher, conversationId, isUploading]);

    // --- Effects ---
    // Effect to reset state when loaderData changes
    useEffect(() => {
        console.log(`Effect: conversationId changed or loaderData updated for ${conversationId}. Resetting state.`);
        setMessages(loaderData.messages ?? []);
        setUploadedFiles(loaderData.uploadedFiles ?? []);
        setInputText(""); setUiError(null);
        const timer = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 150);
        return () => clearTimeout(timer);
    }, [loaderData]); // Depend ONLY ON loaderData reference change

    // Initial conversation list load
    useEffect(() => { if (conversationList.length === 0 && !isLoadingList) loadConversations(false); }, [conversationList.length, isLoadingList, loadConversations]);

    // Load selected model from localStorage on client-side only
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const storedModel = localStorage.getItem('selectedModel');
            if (storedModel) {
                setSelectedModel(storedModel);
            }
        }
    }, []);

    // Save selected model to localStorage when it changes
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('selectedModel', selectedModel);
        }
    }, [selectedModel]);

    // Handle ChatFetcher response (optimistic UI)
    useEffect(() => {
      if (chatFetcher.state === "idle") {
        // Update user messages: mark loading ones as done
        setMessages((prev) =>
          prev
            .map((m) =>
              m.isLoading && m.speaker === "user"
                ? { ...m, isLoading: false }
                : m
            )
            // Optionally remove any leftover loading messages (if desired)
            .filter((m) => !(m.isLoading && m.speaker === "user"))
        );

        const data = chatFetcher.data;
        if (data) {
          if (data.ok && data.type === "chat") {
            const aiMsg = data.aiResponse;
            if (aiMsg?.response) {
              setMessages((prev) => {
                const exists = prev.some(
                  (m) =>
                    (aiMsg.id && m.id === aiMsg.id) ||
                    (m.text === aiMsg.response && m.speaker === "ai")
                );
                return exists
                  ? prev
                  : [
                      ...prev,
                      {
                        id: aiMsg.id || crypto.randomUUID(),
                        speaker: "ai",
                        text: aiMsg.response,
                        sources: aiMsg.sources,
                        created_at: new Date().toISOString(),
                      },
                    ];
              });
              setUiError(null);
            }
          } else if (!data.ok) {
            setUiError(data.error || "Failed to send message.");
            setMessages((prev) => prev.filter((m) => !m.isLoading));
          }
        }
      }
    }, [chatFetcher.state, chatFetcher.data]);

    // Handle Session Upload Fetcher response
    useEffect(() => { /* ... same handling for session uploads ... */
        if (uploadFetcher.state === 'idle' && uploadFetcher.data) {
            const data = uploadFetcher.data;
            if (data.ok && data.type === 'upload') {
                const info = data.uploadInfo; const docId = info?.doc_id; const filename = info?.filename;
                if (filename && docId) setUploadedFiles(prev => prev.some(f => f.doc_id === docId) ? prev : [...prev, { filename, doc_id: docId }]);
                setUiError(null);
            } else if (!data.ok) { setUiError(`Session Upload Error: ${data.error || "Err."}`); }
        }
     }, [uploadFetcher.state, uploadFetcher.data]);

    // Scroll messages to bottom
    useEffect(() => { /* ... same scroll effect ... */
        if (messages.length > 0) { const t = setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 100); return () => clearTimeout(t); }
    }, [messages]);

    useEffect(() => {
        if (!kbsLoaded && !isLoadingKBs) { // Only load if not loaded and not already loading
             setIsLoadingKBs(true);
             console.log("Sidebar Effect: Fetching all KBs for name lookup...");
             listKnowledgeBases()
                 .then(kbs => {
                     setAllKnowledgeBases(kbs ?? []);
                     console.log(`Sidebar Effect: Loaded ${kbs?.length ?? 0} KBs.`);
                 })
                 .catch(err => {
                     console.error("Sidebar Effect: Failed to load KBs for sidebar", err);
                     setUiError("Could not load Knowledge Base list for sidebar.");
                 })
                 .finally(() => {
                      setKbsLoaded(true); // Mark as attempted/loaded
                      setIsLoadingKBs(false);
                 });
        }
    }, [kbsLoaded, isLoadingKBs]); // Dependencies ensure it runs once

    // --- Create KB Name Map for Sidebar ---
    // This map is recreated on each render, but efficient enough for typical KB counts
    const sidebarKbNameMap = new Map<string, string>();
    if (kbsLoaded) { // Only create map if KBs are loaded
         allKnowledgeBases.forEach(kb => {
             sidebarKbNameMap.set(kb.id, kb.name);
         });
    }

    // --- JSX ---
    return (
        <div className="flex h-screen bg-gray-100 dark:bg-dark-bg antialiased text-gray-900 dark:text-dark-text">
            {/* Sidebar */}
            <aside className="w-64 border-r border-gray-200 dark:border-dark-border bg-white dark:bg-dark-card flex flex-col p-4 overflow-y-auto flex-shrink-0">
                {/* New Chat Controls and Button */}
                <div className="mb-4">
                    <label htmlFor="new-chat-kb" className="block text-xs font-medium text-gray-600 dark:text-dark-muted mb-1">
                        Select KB for New Chat
                    </label>
                    <select
                        id="new-chat-kb"
                        value={selectedKbForNewChat}
                        onChange={(e) => setSelectedKbForNewChat(e.target.value)}
                        className="w-full p-2 border bg-gray-100 dark:bg-dark-border border-gray-100 dark:border-dark-border rounded text-sm text-gray-800 dark:text-dark-text focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="">None</option>
                        {kbsLoaded &&
                        allKnowledgeBases.map((kb) => (
                            <option key={kb.id} value={kb.id}>
                            {kb.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="mb-4">
                    <label htmlFor="model-select" className="block text-xs font-medium text-gray-600 dark:text-dark-muted mb-1">
                        Select Model
                    </label>
                    <select
                        id="model-select"
                        className="w-full p-2 border bg-gray-100 dark:bg-dark-border border-gray-100 dark:border-dark-border rounded text-sm text-gray-800 dark:text-dark-text focus:outline-none focus:ring-2 focus:ring-blue-500"
                        onChange={(e) => setSelectedModel(e.target.value)}
                        value={selectedModel}
                    >
                        <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo-Free">Llama-3.3-70B-Instruct-Turbo</option>
                        <option value="meta-llama/Llama-Vision-Free">Llama-Vision</option>
                        <option value="deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free">DeepSeek-R1-Distill-Llama-70B</option>
                    </select>
                </div>
                <button type="button" onClick={handleNewChat} disabled={isCreatingChat} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-green-500 mb-4 transition-colors duration-150 disabled:opacity-60">
                    {isCreatingChat ? <ArrowPathIcon className="h-5 w-5 animate-spin"/> : <PlusIcon className="h-5 w-5" />} New Chat
                </button>
                <hr className="my-2 border-gray-200 dark:border-dark-border"/>
                {/* Uploaded Session Files List */}
                <div className="mb-4">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-xs font-semibold text-gray-500 dark:text-dark-muted uppercase tracking-wide px-1">Session Files</h3>
                        <button
                            type="button"
                            onClick={handleUploadButtonClick}
                            disabled={isUploading || !conversationId}
                            title={isUploading ? "Uploading..." : "Upload Session File"}
                            className="flex-shrink-0 p-1 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-border focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 transition-colors duration-150"
                        >
                            {isUploading ? ( <ArrowPathIcon className="h-4 w-4 animate-spin text-blue-500" /> ) : ( <PaperClipIcon className="h-4 w-4" /> )}
                        </button>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-800 rounded-md p-2 border border-gray-100 dark:border-dark-border shadow-sm">
                        {uploadedFiles.length === 0 ? (<p className="text-sm text-gray-400 dark:text-gray-500 italic px-1">(No files uploaded)</p> ) : ( <ul className="space-y-1 max-h-40 overflow-y-auto"> {uploadedFiles.map((file) => ( <li key={file.doc_id} title={file.filename} className="flex items-center gap-2 text-sm text-gray-700 dark:text-dark-text truncate px-1 py-0.5"> <DocumentTextIcon className="h-4 w-4 text-gray-400 dark:text-gray-500 flex-shrink-0" /> <span className="truncate">{file.filename}</span> </li> ))} </ul> )}
                    </div>
                </div>
                <hr className="my-2 border-gray-200 dark:border-dark-border"/>
                {/* Conversation List - Updated to show KB name */}
                {conversationList.length > 0 && (
                        <ul className="space-y-1 overflow-y-auto flex-grow min-h-0 mb-2">
                            {conversationList.map(conv => {
                                // Look up KB name from the fetched list
                                const kbName = conv.knowledge_base_id ? sidebarKbNameMap.get(conv.knowledge_base_id) : null;

                                return (
                                    <li key={conv.id}>
                                        <Link
                                            to={`/chat/${conv.id}`}
                                            className={`block px-2 py-1 rounded text-sm transition-colors duration-150 ${ conv.id === conversationId ? 'text-blue-700 dark:text-blue-400 font-medium' : 'text-gray-700 dark:text-dark-text hover:text-gray-900 dark:hover:text-blue-300' }`}
                                            title={`Chat from ${new Date(conv.created_at).toLocaleString()}${kbName ? ` (KB: ${kbName})` : ''}`}
                                            prefetch="intent"
                                        >
                                            <div className="flex justify-between items-center bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md p-2">
                                                <span className="truncate mr-2">Chat {conv.id.substring(0, 8)}...</span>
                                                {/* KB Indicator Badge - Uses looked-up name */}
                                                {kbName && conv.knowledge_base_id && (
                                                    <Link
                                                        to={`/kbs/${conv.knowledge_base_id}`} // Link to KB page
                                                        onClick={(e) => e.stopPropagation()} // Prevent chat link nav
                                                        className="flex items-center gap-1 px-1 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 hover:text-blue-800 dark:hover:text-blue-200 rounded text-xs flex-shrink-0"
                                                        title={`Knowledge Base: ${kbName}`}
                                                    >
                                                        <CircleStackIcon className="h-3 w-3" />
                                                        <span className="truncate max-w-[80px]">{kbName}</span>
                                                    </Link>
                                                )}
                                            </div>
                                        </Link>
                                    </li>
                                );
                             })}
                            <li>
                                {canLoadMoreConversations && conversationList.length > 0 && ( <button type="button" onClick={handleLoadMoreConversations} disabled={isLoadingList} className="mt-auto flex-shrink-0 w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded text-xs font-medium text-gray-600 dark:text-dark-muted bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-dark-bg focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity duration-150 italic bold"> {isLoadingList ? (<> <ArrowPathIcon className="animate-spin h-3 w-3 mr-1"/> Loading... </>) : (<> Load More <ChevronDownIcon className="h-3 w-3 ml-1"/> </>)} </button> )}
                            </li>
                        </ul>
                    )}
            </aside>

            {/* Main Chat Area */}
            <main className="flex-grow flex flex-col rounded bg-white dark:bg-dark-card">
                {/* Header - MODIFIED */}
                <header className="p-4 rounded mx-2 my-1 flex-shrink-0 bg-gray-100 dark:bg-gray-800">
                    <div className="flex justify-between items-center max-w-[95%]">
                        {/* Home Link */}
                        <div className="rounded-md flex-shrink-0 mr-2 bg-blue-100 dark:bg-blue-900 p-1 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors duration-150">
                            <Link to="/" className="px-2 py-1 rounded text-sm text-blue-600 dark:text-blue-300 transition-colors flex items-center gap-1 flex-shrink-0 mr-2">
                            <HomeIcon className="h-4 w-4 mr-1"/> Home
                            </Link>
                        </div>
                        {/* Title/ID/KB Section - Centered */}
                        <div className="flex-grow text-center flex flex-col items-center overflow-hidden px-2 rounded bg-gray-100 dark:bg-gray-800 p-2">
                             <div className="flex items-center justify-between w-full">
                                <div className="w-8"></div>
                                <h1 className="text-base sm:text-lg font-semibold text-gray-800 dark:text-dark-text truncate" title={`Chat ID: ${conversationId}`}>
                                    CassaGPT Demo Chat
                                </h1>
                                <SafeThemeToggle />
                             </div>
                             {/* Display Chat ID */}
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 p-2"> <strong>Conversation ID: </strong>{conversationId}</p>
                             {/* Display Linked KB from loaderData */}
                             <div className="flex flex-wrap gap-2 justify-center">
                                {loaderData.knowledge_base ? (
                                   <div className="bg-blue-100 dark:bg-blue-900 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors duration-150 p-1 flex items-center gap-1">
                                       <p className="text-xs text-gray-500 dark:text-gray-400 m-0.5 flex items-center justify-center gap-1" title={`Using Knowledge Base: ${loaderData.knowledge_base.name}`}>
                                           <CircleStackIcon className="h-3 w-3 text-gray-400 dark:text-gray-500 flex-shrink-0"/>
                                           <Link to={`/kbs/${loaderData.knowledge_base.id}`} className="text-blue-600 dark:text-blue-300 hover:underline font-medium truncate">
                                               {loaderData.knowledge_base.name}
                                           </Link>
                                       </p>
                                   </div>
                                ) : (
                                     <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-0.5">No KB linked</p>
                                )}
                                {/* Display Model */}
                                <div className="bg-purple-100 dark:bg-purple-900/40 rounded hover:bg-purple-200 dark:hover:bg-purple-800/60 transition-colors duration-150 p-1 flex items-center gap-1">
                                    <p className="text-xs text-gray-500 dark:text-gray-400 m-0.5 flex items-center justify-center gap-1" title={`Using Model: ${loaderData.model_id || "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free"}`}>
                                        <CpuChipIcon className="h-3 w-3 text-gray-400 dark:text-gray-500 flex-shrink-0"/>
                                        <span className="text-purple-600 dark:text-purple-300 font-medium truncate">
                                            {loaderData.model_id ? loaderData.model_id.split('/').pop() : "Llama-3.3-70B-Instruct-Turbo"}
                                        </span>
                                    </p>
                                </div>
                             </div>
                        </div>

                        {/* Empty space for balance */}
                        <div className="w-16 flex-shrink-0 ml-2"></div>
                    </div>
                </header>
                {/* END HEADER */}


                {/* Message List */}
                <div className="flex-grow p-4 overflow-y-auto space-y-4 bg-white dark:bg-dark-card">
                    {uiError && <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300" role="alert">{uiError} <button type="button" onClick={() => setUiError(null)} className="float-right font-bold text-red-800 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 text-lg leading-none">×</button> </div>}
                    {messages.map((msg) => (
                       <div key={msg.id} className={`flex w-full ${msg.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                         <div className={`flex flex-col max-w-[80%] ${msg.speaker === 'user' ? 'items-end' : 'items-start'}`}>
                           <div className={`p-3 rounded-lg whitespace-pre-wrap break-words shadow-sm ${msg.speaker === 'user' ? 'bg-blue-500 text-white' : (msg.speaker === 'system' ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-200 text-xs' : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200')} ${msg.isLoading && msg.speaker === 'user' ? 'opacity-70 animate-pulse' : ''}`}>
                                {msg.text}
                           </div>
                           {msg.speaker === 'ai' && msg.sources && msg.sources.length > 0 && (
                                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 opacity-80 px-1">
                                    Sources: {msg.sources.map((s, index) => (
                                        <span key={index} title={s?.filename ? `${s.type}: ${s.filename}` : `Type: ${s?.type || 'unknown'}`} className={`${s?.type === 'knowledge_base' ? 'font-medium text-blue-600 dark:text-blue-400' : ''} ${s?.type === 'session_upload' ? 'italic text-green-700 dark:text-green-500' : ''}`}>
                                             {s?.filename?.split(/[\\/]/).pop() || s?.doc_id?.substring(0, 6) || s?.type || 'context'}
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
                <div className="p-4 flex-shrink-0 bg-white dark:bg-dark-card border-t border-gray-200 dark:border-dark-border">
                     <div className="flex items-end gap-2">
                        {/* Session File Upload Button */}
                        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp" disabled={isUploading || !conversationId} />
                        <button type="button" onClick={handleUploadButtonClick} disabled={isUploading || !conversationId} title={isUploading ? "Uploading..." : "Upload Session File"} className="flex-shrink-0 p-2 rounded-md text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-dark-bg focus:ring-blue-500 disabled:opacity-50 transition-colors duration-150"> {isUploading ? ( <ArrowPathIcon className="h-5 w-5 animate-spin text-blue-500 dark:text-blue-400" /> ) : ( <PaperClipIcon className="h-5 w-5" /> )} </button>

                        {/* Chat Input Form */}
                        <Form method="post" action={`/chat/${conversationId}`} onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex-grow flex gap-2 items-end">
                            <input type="hidden" name="intent" value="chat" />
                                <textarea ref={chatInputRef} name="query" rows={1} className="flex-grow block w-full px-3 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm disabled:opacity-50 resize-none leading-tight" placeholder={isAiLoading ? "AI is thinking..." : "Type your message..."} value={inputText} onChange={(e) => { setInputText(e.target.value); e.target.style.height = 'auto'; const maxHeight = 5 * 24; e.target.style.height = `${Math.min(e.target.scrollHeight, maxHeight)}px`; }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !isAiLoading && !isUploading && inputText.trim()) { e.preventDefault(); handleSendMessage(); e.currentTarget.style.height = 'auto'; } }} disabled={isAiLoading || isUploading || !conversationId} />
                            <button type="submit" className="flex-shrink-0 inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-blue-500 disabled:opacity-50 transition-colors duration-150 h-[40px]" disabled={isAiLoading || isUploading || !inputText.trim() || !conversationId || chatFetcher.state !== 'idle'}> {isAiLoading ? (<ArrowPathIcon className="animate-spin h-5 w-5"/>) : (<PaperAirplaneIcon className="h-5 w-5"/>) } <span className="ml-2 hidden sm:inline">{isAiLoading ? "Sending..." : "Send"}</span> </button>
                        </Form>
                    </div>
                    {/* Display Session Upload Error */}
                    {uploadFetcher.state === 'idle' && uploadFetcher.data && !uploadFetcher.data.ok && ( <p className="text-xs text-red-600 dark:text-red-400 mt-1 ml-12">{`Session Upload failed: ${uploadFetcher.data.error}`}</p> )}
                     {/* Display Chat Error */}
                    {chatFetcher.state === 'idle' && chatFetcher.data && !chatFetcher.data.ok && ( <p className="text-xs text-red-600 dark:text-red-400 mt-1 ml-12">{`Message failed: ${chatFetcher.data.error}`}</p> )}
                 </div>
            </main>
        </div>
      );
}

// --- Error Boundary ---
export function ErrorBoundary() {
  const error = useRouteError();
  const params = useParams();
  console.error(`Error Boundary for chat/${params.conversationId || 'unknown'}:`, error);
  let status = 500; let message = "An unexpected error occurred.";

  // Check for specific errors
  const isTurboStreamError = error instanceof Error &&
    error.message.includes("Unable to decode turbo-stream response");

  const is502Error = isRouteErrorResponse(error) && error.status === 502;

  // Check if this is a reload after a successful Excel upload
  const isExcelUploadReload = sessionStorage.getItem('chatExcelUploadSuccess') === 'true';

  // If this is a reload after Excel upload, clear the flag and redirect back to the chat page
  if (isExcelUploadReload && isTurboStreamError) {
    console.log("Detected reload after Excel upload in chat, redirecting back");
    sessionStorage.removeItem('chatExcelUploadSuccess');
    window.location.href = `/chat/${params.conversationId}`;
    // Show a temporary message while redirecting
    message = "Your Excel file was uploaded successfully. Redirecting...";
    status = 200;
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto text-center min-h-screen bg-white dark:bg-dark-bg">
        <div className="flex justify-end mb-4">
          <SafeThemeToggle />
        </div>
        <h1 className="mt-2 text-xl font-semibold text-green-600 dark:text-green-400">Success</h1>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{message}</p>
        <div className="mt-6 flex justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  // If it's the turbo-stream error, provide a more helpful message
  if (isTurboStreamError) {
    message = "There was an issue uploading the file. This is likely due to an Excel file format. Please try a different file format or contact support.";
    status = 400; // Use a 400 status to indicate it's a client-side issue
  } else if (is502Error) {
    message = "The server is temporarily unavailable. Your file was likely uploaded successfully. Please refresh the page to see if your document appears in the list.";
    status = 502;
  } else if (isRouteErrorResponse(error)) {
    status = error.status;
    try { // Attempt to parse detail from common error structures
       const errorData = typeof error.data === 'string' ? JSON.parse(error.data) : error.data;
       message = errorData?.detail || errorData?.message || error.statusText || `Request failed with status ${status}`;
    } catch(e) { message = error.data || error.statusText || `Request failed with status ${status}`; }
  } else if (error instanceof Error) { message = error.message; }

  return (
     <div className="p-4 md:p-6 max-w-4xl mx-auto text-center min-h-screen bg-white dark:bg-dark-bg">
        <div className="flex justify-end mb-4">
          <SafeThemeToggle />
        </div>
        <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-red-400 dark:text-red-500" />
        <h1 className="mt-2 text-xl font-semibold text-red-800 dark:text-red-400">Error {status}</h1>
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{message}</p>
        <div className="mt-6 flex justify-center space-x-4">
          {is502Error && (
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 dark:bg-blue-700 hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-blue-500"
            >
              Refresh Page
            </button>
          )}
          <Link to="/" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-gray-500">
            Back to Home
          </Link>
        </div>
     </div>
  );
}