// frontend/app/routes/_index.tsx

import { redirect, json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, Link, useFetcher, useNavigate } from "@remix-run/react"; // Added useNavigate
import {
    createConversation,
    listConversations,
    listKnowledgeBases,
    type ConversationInfo, // This type should ideally only have knowledge_base_id
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
import { useState, useEffect, useMemo } from "react"; // Added useMemo

// --- Loader ---
export async function loader({ request }: LoaderFunctionArgs) {
    try {
        console.log("Index Loader: Fetching conversations (with KB ID) and KBs...");
        // listConversations now returns ConversationInfo[] which includes nested KB object
        const [conversations, knowledgeBases] = await Promise.all([
            listConversations(0, 10), // Fetch latest 10 conversations
            listKnowledgeBases()       // Fetch all knowledge bases
        ]);
        console.log(`Index Loader: Found ${conversations?.length ?? 0} convos, ${knowledgeBases?.length ?? 0} KBs.`);
        // Ensure arrays are returned even if API gives null/undefined
        return json({
            conversations: Array.isArray(conversations) ? conversations : [],
            knowledgeBases: Array.isArray(knowledgeBases) ? knowledgeBases : [],
            error: null
        });
    } catch (error: any) {
        console.error("Index Loader Error:", error);
        // Determine error message safely
        let detail = "Failed to load initial data.";
        if (error instanceof Response) {
            try {
                // Try to get text, might contain more info than statusText
                const errorText = await error.text();
                detail = errorText || error.statusText || `API Error (${error.status})`;
            } catch (_) {
                 detail = error.statusText || `API Error (${error.status})`;
            }
        } else if (error?.message) {
            detail = error.message;
        }
        // Ensure arrays are returned in error case too
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

          if (newConv?.id) { // Check if newConv and newConv.id exist
            console.log("Index Action: Redirecting to:", `/chat/${newConv.id}`);
            return redirect(`/chat/${newConv.id}`);
          } else { throw new Error("Failed to get conversation ID from API"); }
        } catch (error: any) {
          console.error("Index Action: Failed to create new conversation:", error);
          let detail = "Failed to create conversation";
           if (error instanceof Response) {
              try {
                  const errorText = await error.text();
                  detail = errorText || error.statusText || `API Error (${error.status})`;
              } catch (_) {
                   detail = error.statusText || `API Error (${error.status})`;
              }
           } else if (error?.message) { detail = error.message; }
          return json({ error: detail }, { status: error?.status || 500 });
        }
    } else if (intent === "newKB") {
        const name = formData.get("kbName") as string;
        const description = formData.get("kbDescription") as string;
        if (!name || typeof name !== 'string' || !name.trim()) {
             return json({ error: "KB Name is required and cannot be empty"}, { status: 400 });
        }
         try {
            await createKnowledgeBase({ name: name.trim(), description: description?.trim() || null });
            // Return simple success, rely on useEffect with navigate to revalidate
            return json({ ok: true, message: "KB Created!" });
         } catch(error: any) {
            let detail = "Failed to create KB";
             if (error instanceof Response) {
                 try {
                    const errorText = await error.text();
                    detail = errorText || error.statusText || `API Error (${error.status})`;
                 } catch (_) {
                    detail = error.statusText || `API Error (${error.status})`;
                 }
             } else if (error?.message) { detail = error.message; }
            return json({ error: detail }, { status: error?.status || 500 });
         }
    }
    // Default return if intent doesn't match
    return json({ error: "Invalid intent provided" }, { status: 400 });
}


// --- Component ---
export default function Index() {
  // Use loader data, default to empty arrays if properties are missing
  const {
      conversations: initialConversations = [], // Default to empty array
      knowledgeBases = [], // Default to empty array
      error: loaderError
  } = useLoaderData<typeof loader>();

  const navigation = useNavigation();
  const kbCreateFetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  const [selectedKbId, setSelectedKbId] = useState<string>("none");
  const [showKbForm, setShowKbForm] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDescription, setNewKbDescription] = useState("");

  // Safely initialize state based on potentially empty initialConversations
  const [conversationList, setConversationList] = useState<ConversationInfo[]>(() =>
      Array.isArray(initialConversations)
          ? initialConversations.filter((conv): conv is ConversationInfo => conv !== null)
          : []
  );
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // Initialize canLoadMore based on the actual initial list length
  const [canLoadMoreConversations, setCanLoadMoreConversations] = useState(
      Array.isArray(initialConversations) && initialConversations.length === 10
  );

  const isCreatingChat = navigation.state === "submitting" && navigation.formData?.get("intent") === "newChat";
  const isCreatingKb = kbCreateFetcher.state !== 'idle';

  // Safely create KB Name Map using useMemo
  const kbNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (Array.isArray(knowledgeBases)) {
        knowledgeBases.forEach(kb => {
            if (kb?.id && kb.name) { map.set(kb.id, kb.name); }
        });
    }
    return map;
  }, [knowledgeBases]);

  // Function to load more conversations
  const loadMoreConversations = async () => {
    if (isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const newConvos = await listConversations(conversationList.length, 10);
      if (Array.isArray(newConvos)) {
          setConversationList(prev => [...prev, ...newConvos]);
          setCanLoadMoreConversations(newConvos.length === 10);
      } else {
          console.warn("Load more conversations returned non-array:", newConvos);
          setCanLoadMoreConversations(false);
      }
    } catch (error: any) {
      console.error("Error loading more conversations:", error);
      setCanLoadMoreConversations(false); // Stop loading on error
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Handler for Create KB form submission
  const handleCreateKb = (event: React.FormEvent<HTMLFormElement>) => {
     event.preventDefault();
     const trimmedName = newKbName.trim();
     if (!trimmedName || isCreatingKb) return;
     kbCreateFetcher.submit(
         { intent: "newKB", kbName: trimmedName, kbDescription: newKbDescription.trim() },
         { method: "post" }
     );
  };

  // Effect to clear form and revalidate after successful KB creation
  useEffect(() => {
     if (kbCreateFetcher.state === 'idle' && kbCreateFetcher.data?.ok) {
          setNewKbName(""); setNewKbDescription(""); setShowKbForm(false);
          console.log("KB Creation successful, revalidating index loader...");
          navigate('.', { replace: true, state: { scroll: false } }); // Re-runs loader
     } else if (kbCreateFetcher.state === 'idle' && kbCreateFetcher.data?.error) {
          // Optionally set a UI error state here to display to the user
          console.error("KB Creation Error:", kbCreateFetcher.data.error);
     }
  }, [kbCreateFetcher.state, kbCreateFetcher.data, navigate]);

   // Effect to update conversation list if initial data changes (e.g., after revalidation)
   useEffect(() => {
       // Only update state if the initial data actually changed reference
       setConversationList(
           Array.isArray(initialConversations)
               ? initialConversations.filter((conv): conv is ConversationInfo => conv !== null)
               : []
       );
       setCanLoadMoreConversations(
            Array.isArray(initialConversations) && initialConversations.length === 10
       );
   }, [initialConversations]); // Depend only on the initial data from loader


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-7xl mx-auto">

        {/* Left Column: Recent Conversations */}
        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md w-full sm:w-1/3 lg:w-1/4 max-h-[85vh] flex flex-col">
          <h2 className="text-lg font-semibold text-gray-700 mb-4 border-b pb-2 flex items-center flex-shrink-0">
            <ChatBubbleLeftRightIcon className="h-5 w-5 mr-2 text-gray-400"/> Recent Conversations
          </h2>
          {/* Conditional rendering based on conversationList */}
          {Array.isArray(conversationList) && conversationList.length > 0 ? (
            <>
              <ul className="space-y-2 overflow-y-auto flex-grow mb-2">
                {conversationList.map(conv => {
                  // kbNameMap is now created safely with useMemo
                  const kbName = conv?.knowledge_base_id ? kbNameMap.get(conv.knowledge_base_id) : null;
                  // Add checks for conv object itself just in case
                  if (!conv?.id) return null; // Skip rendering if conv or id is missing

                  return (
                    <li key={conv.id}>
                      {/* *** Link wrapping spans for Hydration Fix *** */}
                      <Link
                        to={`/chat/${conv.id}`}
                        className="flex justify-between items-center p-3 rounded-md text-sm bg-gray-50 hover:bg-gray-100 text-gray-800 hover:text-blue-800 transition duration-150 ease-in-out group" // Flex applied here
                        prefetch="intent"
                        title={`Chat from ${new Date(conv.created_at).toLocaleString()}${kbName ? ` (KB: ${kbName})` : ''}`}
                      >
                        {/* Left side content */}
                        <span className="flex items-center gap-2 min-w-0 mr-2"> {/* Use span */}
                          <ChatBubbleLeftRightIcon className="h-4 w-4 flex-shrink-0 text-gray-400"/>
                          <span className="font-mono text-xs truncate">ID: {conv.id.substring(0, 8)}...</span>
                        </span>
                        {/* Right side content */}
                        <span className="flex items-center gap-2 text-xs flex-shrink-0"> {/* Use span */}
                          {kbName && conv.knowledge_base_id && (
                            <Link
                              to={`/kbs/${conv.knowledge_base_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 hover:bg-blue-200 hover:text-blue-800 rounded text-xs truncate"
                              title={`Knowledge Base: ${kbName}`}
                            >
                              <CircleStackIcon className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate max-w-[60px] sm:max-w-[80px]">{kbName}</span>
                            </Link>
                          )}
                          <span className="text-gray-500 whitespace-nowrap">
                            {new Date(conv.created_at).toLocaleDateString()}
                          </span>
                        </span>
                      </Link>
                      {/* *** End Link *** */}
                    </li>
                  );
                })}
              </ul>
              {/* Load More Button */}
              {canLoadMoreConversations && (
                <div className="mt-auto pt-4 flex justify-center flex-shrink-0">
                  <button
                    type="button"
                    onClick={loadMoreConversations}
                    disabled={isLoadingMore}
                    className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-600 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 disabled:opacity-50 transition-opacity duration-150"
                  >
                    {isLoadingMore ? (<ArrowPathIcon className="animate-spin h-3 w-3 mr-1"/>) : "Show More"}
                  </button>
                </div>
              )}
            </>
          ) : (
             <div className="flex-grow flex items-center justify-center">
                  <p className="text-sm text-gray-500 italic text-center">No conversations found.</p>
              </div>
          )}
        </div>

        {/* Right Column: Welcome/New Conversation and KB Section */}
        <div className="flex flex-col gap-6 w-full sm:w-2/3 lg:w-3/4">
          {/* Welcome & New Conversation Form */}
          <div className="bg-white p-6 sm:p-8 rounded-lg shadow-md text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-4"> Welcome to CassaGPT </h1>
            <p className="text-gray-600 mb-6 text-sm sm:text-base"> Start a new chat or select an existing one from the list. </p>
            <Form method="post" className="space-y-4 max-w-md mx-auto">
              <input type="hidden" name="intent" value="newChat" />
              <div>
                <label htmlFor="kb-select" className="block text-sm font-medium text-gray-700 mb-1 text-left"> Select Knowledge Base (Optional) </label>
                <select id="kb-select" name="kbId" value={selectedKbId} onChange={(e) => setSelectedKbId(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm">
                  <option value="none">-- None --</option>
                  {/* Safely map over knowledgeBases */}
                  {Array.isArray(knowledgeBases) && knowledgeBases.map(kb => (
                    kb?.id && kb.name ? <option key={kb.id} value={kb.id}>{kb.name}</option> : null
                  ))}
                </select>
              </div>
              <button type="submit" className="w-full px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 transition" disabled={isCreatingChat}>
                {isCreatingChat ? ( <span className="flex items-center justify-center"> <ArrowPathIcon className="animate-spin h-5 w-5 mr-2"/> Starting... </span> ) : "Start New Conversation"}
              </button>
            </Form>
          </div>

          {/* Existing Knowledge Bases with Create KB Button in header */}
          <div className="bg-white p-6 rounded-lg shadow-md">
            <div className="flex items-center justify-between mb-4 border-b pb-2">
              <h2 className="text-lg font-semibold text-gray-700 flex items-center"> <CircleStackIcon className="h-5 w-5 mr-2 text-gray-400"/> Existing Knowledge Bases </h2>
              {!showKbForm && (
                <button type="button" onClick={() => setShowKbForm(true)} className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md shadow-sm text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
                  <PlusIcon className="-ml-1 mr-1 h-4 w-4 text-gray-400"/> New KB
                </button>
              )}
            </div>
            {/* Create KB Form */}
            {showKbForm && (
              <kbCreateFetcher.Form method="post" onSubmit={handleCreateKb} className="space-y-3 mb-4 p-4 border border-gray-200 rounded-md bg-gray-50">
                <input type="hidden" name="intent" value="newKB" />
                <h3 className="text-md font-medium text-gray-800 mb-2">Create New Knowledge Base</h3>
                <div>
                  <label htmlFor="kbName" className="block text-xs font-medium text-gray-600 mb-1">Name<span className="text-red-500">*</span></label>
                  <input type="text" name="kbName" id="kbName" value={newKbName} onChange={e => setNewKbName(e.target.value)} required className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="KB Name" />
                </div>
                <div>
                  <label htmlFor="kbDescription" className="block text-xs font-medium text-gray-600 mb-1">Description</label>
                  <textarea name="kbDescription" id="kbDescription" rows={2} value={newKbDescription} onChange={e => setNewKbDescription(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm resize-none" placeholder="Optional description..." />
                </div>
                {kbCreateFetcher.data?.error && ( <p className="text-xs text-red-600">{kbCreateFetcher.data.error}</p> )}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowKbForm(false)} className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"> Cancel </button>
                  <button type="submit" disabled={isCreatingKb || !newKbName.trim()} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"> {isCreatingKb ? (<><ArrowPathIcon className="animate-spin h-4 w-4 mr-2"/>Creating...</>) : "Create KB"} </button>
                </div>
              </kbCreateFetcher.Form>
            )}

             {/* KB List */}
             {Array.isArray(knowledgeBases) && knowledgeBases.length > 0 ? (
                <ul className="space-y-2 max-h-60 overflow-y-auto">
                  {knowledgeBases.map(kb => (
                     kb?.id && kb.name ? ( // Check kb exists and has needed properties
                         <li key={kb.id}>
                           {/* *** Link wrapping spans for Hydration Fix *** */}
                           <Link
                             to={`/kbs/${kb.id}`}
                             className="flex justify-between items-center p-3 rounded-md bg-gray-50 hover:bg-gray-100 text-gray-800 hover:text-blue-700 transition duration-150 ease-in-out group" // Flex applied here
                             prefetch="intent"
                             title={`View KB: ${kb.name}`}
                           >
                             {/* Use spans for content */}
                             <span className="flex flex-col min-w-0 mr-2">
                               <span className="font-medium text-sm truncate">{kb.name}</span>
                               <span className="text-xs text-gray-500 truncate italic">{kb.description || 'No description'}</span>
                             </span>
                             <ArrowRightIcon className="h-4 w-4 text-gray-400 group-hover:text-blue-600 transition-colors flex-shrink-0"/>
                           </Link>
                           {/* *** End Link *** */}
                         </li>
                     ) : null
                  ))}
                </ul>
             ) : (
                 !showKbForm && <p className="text-sm text-gray-500 italic text-center mt-4">No Knowledge Bases created yet.</p> // Show only if form is hidden
             )}
          </div>

          {/* Loader Error Display */}
          {loaderError && (
            <div className="bg-red-50 p-4 rounded-md border border-red-200 text-sm text-red-700 w-full mt-4">
              <strong>Error loading data:</strong> {typeof loaderError === 'string' ? loaderError : JSON.stringify(loaderError)}
            </div>
          )}

        </div>
      </div>
      {/* Footer */}
      <footer className="pt-8 text-sm text-gray-500 text-center">
            <p>Demo for Educational Purposes only</p>
            <p> Created by <em>Rodrigo Meza</em> for <strong><em>Grupo CASSA</em></strong> </p>
      </footer>
    </div>
  );
}