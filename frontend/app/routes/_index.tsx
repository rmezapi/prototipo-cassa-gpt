// frontend/app/routes/_index.tsx

import { redirect, json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, Link, useFetcher, useNavigate } from "@remix-run/react"; // Added useNavigate
import {
    createConversation,
    listConversations,
    listKnowledgeBases,
    type ConversationInfo, // This type now includes nested KB info
    type KnowledgeBaseInfo,
    createKnowledgeBase
} from "~/lib/apiClient";
import {
    ArrowPathIcon,
    ChatBubbleLeftRightIcon,
    CircleStackIcon,
    PlusIcon,
    ArrowRightIcon // Keep for KB list links
} from '@heroicons/react/24/outline';
import { useState, useEffect } from "react";

// --- Loader ---
export async function loader({ request }: LoaderFunctionArgs) {
    try {
        console.log("Index Loader: Fetching conversations (with KB info) and KBs...");
        // listConversations now returns ConversationInfo[] which includes nested KB object
        const [conversations, knowledgeBases] = await Promise.all([
            listConversations(0, 10), // Fetch latest 10 conversations
            listKnowledgeBases()       // Fetch all knowledge bases
        ]);
        console.log(`Index Loader: Found ${conversations.length} convos, ${knowledgeBases.length} KBs.`);
        return json({ conversations: conversations ?? [], knowledgeBases: knowledgeBases ?? [], error: null });
    } catch (error: any) {
        console.error("Index Loader Error:", error);
        const detail = (error instanceof Response ? (await error.text()) : error?.message) || "Failed to load initial data.";
        return json({ conversations: [], knowledgeBases: [], error: detail }, { status: error?.status || 500 });
    }
}

// --- Action ---
export async function action({ request }: ActionFunctionArgs) {
    const formData = await request.formData();
    const intent = formData.get("intent");
    const kbId = formData.get("kbId") as string | null;
    console.log(`Index Action: Received intent=${intent}, kbId=${kbId}`);

    if (intent === "newChat") {
        try {
          const selectedKbId = kbId && kbId !== "none" ? kbId : null;
          console.log(`Index Action: Creating new conversation (KB ID: ${selectedKbId})...`);
          const newConv = await createConversation(selectedKbId); // API returns ConversationInfo

          if (newConv.id) {
            console.log("Index Action: Redirecting to:", `/chat/${newConv.id}`);
            return redirect(`/chat/${newConv.id}`);
          } else { throw new Error("Failed to get conversation ID from API"); }
        } catch (error: any) {
          console.error("Index Action: Failed to create new conversation:", error);
          const detail = (error instanceof Response ? (await error.text()) : error?.message) || "Failed to create conversation";
          return json({ error: detail }, { status: error?.status || 500 });
        }
    } else if (intent === "newKB") {
        const name = formData.get("kbName") as string;
        const description = formData.get("kbDescription") as string;
        if (!name) return json({ error: "KB Name is required"}, { status: 400 });
         try {
            await createKnowledgeBase({ name, description });
            // Return simple success, rely on useEffect with navigate to revalidate
            return json({ ok: true, message: "KB Created!" });
         } catch(error: any) {
            const detail = (error instanceof Response ? (await error.text()) : error?.message) || "Failed to create KB";
            return json({ error: detail }, { status: error?.status || 500 });
         }
    }
    return json({ error: "Invalid intent" }, { status: 400 });
}


// --- Component ---
export default function Index() {
  const { conversations, knowledgeBases, error: loaderError } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const kbCreateFetcher = useFetcher<typeof action>(); // Use fetcher for KB creation form
  const navigate = useNavigate(); // Hook for navigation/revalidation

  const [selectedKbId, setSelectedKbId] = useState<string>("none");
  const [showKbForm, setShowKbForm] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDescription, setNewKbDescription] = useState("");

  const isCreatingChat = navigation.state === "submitting" && navigation.formData?.get("intent") === "newChat";
  const isCreatingKb = kbCreateFetcher.state !== 'idle';

  const handleCreateKb = (event: React.FormEvent<HTMLFormElement>) => {
     event.preventDefault(); if (!newKbName.trim() || isCreatingKb) return;
     kbCreateFetcher.submit( { intent: "newKB", kbName: newKbName, kbDescription: newKbDescription }, { method: "post" } );
  };

  // Effect to clear form and revalidate after successful KB creation
  useEffect(() => {
     if (kbCreateFetcher.state === 'idle' && kbCreateFetcher.data?.ok) {
          setNewKbName(""); setNewKbDescription(""); setShowKbForm(false);
          // Trigger revalidation of loader data to refresh KB list
          console.log("KB Creation successful, revalidating index loader...");
          navigate('.', { replace: true, state: { scroll: false } }); // Re-runs loader
     } else if (kbCreateFetcher.state === 'idle' && kbCreateFetcher.data?.error) {
          // Optionally display fetcher.data.error near the form
          console.error("KB Creation Error:", kbCreateFetcher.data.error);
     }
  }, [kbCreateFetcher.state, kbCreateFetcher.data, navigate]);


  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 p-4 sm:p-6 space-y-6 sm:space-y-8">

      {/* Welcome/Create Chat Card */}
      <div className="bg-white p-6 sm:p-8 rounded-lg shadow-md text-center max-w-md w-full">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-4"> Welcome to CassaGPT </h1>
        <p className="text-gray-600 mb-6 text-sm sm:text-base"> Start a new chat or select an existing one below. </p>
        <Form method="post" className="space-y-4">
            <input type="hidden" name="intent" value="newChat" />
            <div>
                 <label htmlFor="kb-select" className="block text-sm font-medium text-gray-700 mb-1 text-left"> Select Knowledge Base (Optional) </label>
                 <select id="kb-select" name="kbId" value={selectedKbId} onChange={(e) => setSelectedKbId(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md">
                    <option value="none">-- None --</option>
                    {knowledgeBases?.map(kb => ( <option key={kb.id} value={kb.id}> {kb.name} </option> ))}
                 </select>
            </div>
            <button type="submit" className={`w-full px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out`} disabled={isCreatingChat}>
                {isCreatingChat ? ( <span className="flex items-center justify-center"> <ArrowPathIcon className="animate-spin h-5 w-5 mr-2" /> Starting... </span> ) : "Start New Conversation"}
            </button>
        </Form>
      </div>

      {/* Create KB Section */}
      <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-md text-center">
           {!showKbForm ? (
                <button type="button" onClick={() => setShowKbForm(true)} className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                   <PlusIcon className="-ml-1 mr-2 h-5 w-5 text-gray-400" /> Create New Knowledge Base
                </button>
           ) : (
               <kbCreateFetcher.Form method="post" onSubmit={handleCreateKb} className="space-y-3 text-left">
                   <input type="hidden" name="intent" value="newKB" />
                    <h3 className="text-lg font-medium text-gray-800 mb-2">New Knowledge Base</h3>
                    <div> <label htmlFor="kbName" className="sr-only">Name</label> <input type="text" name="kbName" id="kbName" value={newKbName} onChange={e => setNewKbName(e.target.value)} required className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="Knowledge Base Name" /> </div>
                    <div> <label htmlFor="kbDescription" className="sr-only">Description</label> <textarea name="kbDescription" id="kbDescription" rows={2} value={newKbDescription} onChange={e => setNewKbDescription(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm resize-none" placeholder="Optional Description..." /> </div>
                    {kbCreateFetcher.data?.error && <p className="text-xs text-red-600">{kbCreateFetcher.data.error}</p>}
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => setShowKbForm(false)} className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500">Cancel</button>
                        <button type="submit" disabled={isCreatingKb || !newKbName.trim()} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"> {isCreatingKb ? (<><ArrowPathIcon className="animate-spin h-4 w-4 mr-2"/>Creating...</>) : "Create KB"} </button>
                    </div>
               </kbCreateFetcher.Form>
           )}
      </div>

      {/* Existing Knowledge Bases List */}
      {knowledgeBases && knowledgeBases.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-700 mb-4 border-b pb-2 flex items-center">
                <CircleStackIcon className="h-5 w-5 mr-2 text-gray-400"/> Existing Knowledge Bases
            </h2>
            <ul className="space-y-2 max-h-60 overflow-y-auto">
                {knowledgeBases.map(kb => (
                    <li key={kb.id}>
                        <Link to={`/kbs/${kb.id}`} className="block p-3 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-800 hover:text-blue-700 transition duration-150 ease-in-out group" prefetch="intent" title={`View KB: ${kb.name}`}>
                           <div className="flex justify-between items-center">
                                <span className="flex flex-col min-w-0 mr-2">
                                    <span className="font-medium text-sm truncate">{kb.name}</span>
                                    <span className="text-xs text-gray-500 truncate italic">{kb.description || 'No description'}</span>
                                </span>
                                <ArrowRightIcon className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0"/>
                           </div>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
      )}

      {/* Recent Conversations List - Updated */}
      {conversations && conversations.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-700 mb-4 border-b pb-2 flex items-center">
                <ChatBubbleLeftRightIcon className="h-5 w-5 mr-2 text-gray-400"/> Recent Conversations
            </h2>
            <ul className="space-y-2 max-h-60 overflow-y-auto">
                {conversations.map(conv => (
                    <li key={conv.id}>
                        <Link
                            to={`/chat/${conv.id}`}
                            className="block p-3 rounded-md text-sm bg-gray-50 hover:bg-gray-100 text-gray-800 hover:text-blue-800 transition duration-150 ease-in-out"
                            prefetch="intent"
                            title={`Chat from ${new Date(conv.created_at).toLocaleString()}${conv.knowledge_base ? ` (KB: ${conv.knowledge_base.name})` : ''}`}
                        >
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2 min-w-0 mr-2">
                                    <ChatBubbleLeftRightIcon className="h-4 w-4 flex-shrink-0 text-gray-400"/>
                                    <span className="font-mono text-xs truncate">ID: {conv.id.substring(0, 8)}...</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs flex-shrink-0">
                                    {/* Display KB Name Badge */}
                                    {conv.knowledge_base && (
                                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs truncate" title={`Knowledge Base: ${conv.knowledge_base.name}`}>
                                            <CircleStackIcon className="h-3 w-3 flex-shrink-0" />
                                            <span className="truncate">{conv.knowledge_base.name}</span>
                                        </span>
                                    )}
                                    <span className="text-gray-500 whitespace-nowrap">
                                        {new Date(conv.created_at).toLocaleDateString()}
                                    </span>
                                </div>
                            </div>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
      )}

      {/* Loader Error Display */}
      {loaderError && (
         <div className="bg-red-50 p-4 rounded-md border border-red-200 w-full max-w-md text-sm text-red-700">
             <strong>Error:</strong> {loaderError}
         </div>
      )}

      <footer className="pt-4 text-sm text-gray-500"> Powered by AI </footer>
    </div>
  );
}