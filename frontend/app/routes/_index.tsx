// frontend/app/routes/_index.tsx

import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData, useNavigation, Link, useFetcher } from "@remix-run/react";
import {
    createConversation,
    listConversations,
    listKnowledgeBases,
    type ConversationInfo, // This type should ideally only have knowledge_base_id
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
import SafeThemeToggle from "~/components/SafeThemeToggle";

// --- Loader ---
export async function loader({}: LoaderFunctionArgs) {
    try {
        console.log("Index Loader: Fetching conversations (with KB ID) and KBs...");
        // listConversations now returns ConversationInfo[] which includes nested KB object
        const [conversations, knowledgeBases] = await Promise.all([
            listConversations(0, 10), // Fetch latest 10 conversations
            listKnowledgeBases()       // Fetch all knowledge bases
        ]);
        console.log(`Index Loader: Found ${conversations?.length ?? 0} convos, ${knowledgeBases?.length ?? 0} KBs.`);
        // Ensure arrays are returned even if API gives null/undefined
        return new Response(JSON.stringify({
            conversations: Array.isArray(conversations) ? conversations : [],
            knowledgeBases: Array.isArray(knowledgeBases) ? knowledgeBases : [],
            error: null
        }), { headers: { 'Content-Type': 'application/json' } });
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
        return new Response(JSON.stringify({ conversations: [], knowledgeBases: [], error: detail }), { status: error?.status || 500, headers: { 'Content-Type': 'application/json' } });
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
          const modelId = formData.get("modelId") as string;
          console.log(`Index Action: Creating new conversation (KB ID: ${selectedKbId}, Model ID: ${modelId})...`);
          console.log(`Index Action: modelId type: ${typeof modelId}, value: ${modelId}`);
          const newConv = await createConversation(selectedKbId, modelId); // API returns ConversationInfo

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
          return new Response(JSON.stringify({ error: detail }), { status: error?.status || 500, headers: { 'Content-Type': 'application/json' } });
        }
    } else if (intent === "newKB") {
        const name = formData.get("kbName") as string;
        const description = formData.get("kbDescription") as string;
        if (!name || typeof name !== 'string' || !name.trim()) {
             return new Response(JSON.stringify({ error: "KB Name is required and cannot be empty" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
         try {
            const newKb = await createKnowledgeBase({ name: name.trim(), description: description?.trim() || null });
            // Redirect directly to the new KB page
            return redirect(`/kbs/${newKb.id}`);
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
            return new Response(JSON.stringify({ error: detail }), { status: error?.status || 500, headers: { 'Content-Type': 'application/json' } });
         }
    }
    // Default return if intent doesn't match
    return new Response(JSON.stringify({ error: "Invalid intent provided" }), { status: 400, headers: { 'Content-Type': 'application/json' } });
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
  // const navigate = useNavigate(); // Not needed since we're using redirect

  const [selectedKbId, setSelectedKbId] = useState<string>("none");
  const [showKbForm, setShowKbForm] = useState(false);
  const [newKbName, setNewKbName] = useState("");
  const [newKbDescription, setNewKbDescription] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("meta-llama/Llama-3.3-70B-Instruct-Turbo-Free");

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

  // Effect to handle KB creation errors
  useEffect(() => {
     if (kbCreateFetcher.state === 'idle' && kbCreateFetcher.data?.error) {
          // Optionally set a UI error state here to display to the user
          console.error("KB Creation Error:", kbCreateFetcher.data.error);
     }
  }, [kbCreateFetcher.state, kbCreateFetcher.data]);

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


  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 dark:bg-gradient-to-br dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-7xl mx-auto">

        {/* Left Column: Recent Conversations */}
        <div className="bg-white dark:bg-dark-card p-4 sm:p-6 rounded-lg shadow-md dark:shadow-gray-900 w-full sm:w-1/3 lg:w-1/4 max-h-[85vh] flex flex-col">
          <h2 className="text-lg font-semibold text-gray-700 dark:text-dark-text mb-4 border-b dark:border-dark-border pb-2 flex items-center flex-shrink-0">
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
                        className="flex justify-between items-center p-3 rounded-md text-sm bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-dark-text hover:text-blue-800 dark:hover:text-blue-400 transition duration-150 ease-in-out group" // Flex applied here
                        prefetch="intent"
                        title={`Chat from ${new Date(conv.created_at).toLocaleString()}${kbName ? ` (KB: ${kbName})` : ''}`}
                      >
                        {/* Left side content */}
                        <span className="flex items-center gap-2 min-w-0 mr-2"> {/* Use span */}
                          <ChatBubbleLeftRightIcon className="h-4 w-4 flex-shrink-0 text-gray-400 dark:text-gray-500"/>
                          <span className="font-mono text-xs truncate">ID: {conv.id.substring(0, 8)}...</span>
                        </span>
                        {/* Right side content */}
                        <span className="flex items-center gap-2 text-xs flex-shrink-0"> {/* Use span */}
                          {kbName && conv.knowledge_base_id && (
                            <Link
                              to={`/kbs/${conv.knowledge_base_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800 hover:text-blue-800 dark:hover:text-blue-200 rounded text-xs truncate"
                              title={`Knowledge Base: ${kbName}`}
                            >
                              <CircleStackIcon className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate max-w-[60px] sm:max-w-[80px]">{kbName}</span>
                            </Link>
                          )}
                          <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
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
                    className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 dark:border-dark-border rounded text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-dark-card hover:bg-gray-50 dark:hover:bg-dark-border focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-dark-bg focus:ring-blue-500 disabled:opacity-50 transition-opacity duration-150"
                  >
                    {isLoadingMore ? (<ArrowPathIcon className="animate-spin h-3 w-3 mr-1"/>) : "Show More"}
                  </button>
                </div>
              )}
            </>
          ) : (
             <div className="flex-grow flex items-center justify-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center">No conversations found.</p>
              </div>
          )}
        </div>

        {/* Right Column: Welcome/New Conversation and KB Section */}
        <div className="flex flex-col gap-6 w-full sm:w-2/3 lg:w-3/4">
          {/* Welcome & New Conversation Form */}
          <div className="bg-white dark:bg-dark-card p-6 sm:p-8 rounded-lg shadow-md dark:shadow-gray-900 text-center">
            <div className="flex justify-between items-center mb-4">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-dark-text"> Welcome to CassaGPT </h1>
              <SafeThemeToggle />
            </div>
            <p className="text-gray-600 dark:text-dark-muted mb-6 text-sm sm:text-base"> Start a new chat or select an existing one from the list. </p>
            <Form method="post" className="space-y-4 max-w-md mx-auto">
              <input type="hidden" name="intent" value="newChat" />
              <div>
                <label htmlFor="kb-select" className="block text-sm font-medium text-gray-700 dark:text-dark-muted mb-1 text-left"> Select Knowledge Base (Optional) </label>
                <select id="kb-select" name="kbId" value={selectedKbId} onChange={(e) => setSelectedKbId(e.target.value)} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-dark-border dark:bg-dark-card dark:text-dark-text focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm">
                  <option value="none">-- None --</option>
                  {/* Safely map over knowledgeBases */}
                  {Array.isArray(knowledgeBases) && knowledgeBases.map(kb => (
                    kb?.id && kb.name ? <option key={kb.id} value={kb.id}>{kb.name}</option> : null
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="model-select" className="block text-sm font-medium text-gray-700 dark:text-dark-muted mb-1 text-left"> Select Model </label>
                <select
                  id="model-select"
                  name="modelId"
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 dark:border-dark-border dark:bg-dark-card dark:text-dark-text focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                >
                  <option value="meta-llama/Llama-3.3-70B-Instruct-Turbo-Free">Llama-3.3-70B-Instruct-Turbo</option>
                  <option value="meta-llama/Llama-Vision-Free">Llama-Vision</option>
                  <option value="deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free">DeepSeek-R1-Distill-Llama-70B</option>
                </select>
              </div>
              <button type="submit" className="w-full px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-green-500 disabled:opacity-50 transition" disabled={isCreatingChat}>
                {isCreatingChat ? ( <span className="flex items-center justify-center"> <ArrowPathIcon className="animate-spin h-5 w-5 mr-2"/> Starting... </span> ) : "Start New Conversation"}
              </button>
            </Form>
          </div>

          {/* Existing Knowledge Bases with Create KB Button in header */}
          <div className="bg-white dark:bg-dark-card p-6 rounded-lg shadow-md dark:shadow-gray-900">
            <div className="flex items-center justify-between mb-4 border-b dark:border-dark-border pb-2">
              <h2 className="text-lg font-semibold text-gray-700 dark:text-dark-text flex items-center"> <CircleStackIcon className="h-5 w-5 mr-2 text-gray-400 dark:text-gray-500"/> Existing Knowledge Bases </h2>
              {!showKbForm && (
                <button type="button" onClick={() => setShowKbForm(true)} className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-dark-border rounded-md shadow-sm text-xs font-medium text-gray-700 dark:text-dark-text bg-white dark:bg-dark-card hover:bg-gray-50 dark:hover:bg-dark-border focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-blue-500">
                  <PlusIcon className="-ml-1 mr-1 h-4 w-4 text-gray-400 dark:text-gray-500"/> New KB
                </button>
              )}
            </div>
            {/* Create KB Form */}
            {showKbForm && (
              <kbCreateFetcher.Form method="post" onSubmit={handleCreateKb} className="space-y-3 mb-4 p-4 border border-gray-200 dark:border-dark-border rounded-md bg-gray-50 dark:bg-gray-800">
                <input type="hidden" name="intent" value="newKB" />
                <h3 className="text-md font-medium text-gray-800 dark:text-dark-text mb-2">Create New Knowledge Base</h3>
                <div>
                  <label htmlFor="kbName" className="block text-xs font-medium text-gray-600 dark:text-dark-muted mb-1">Name<span className="text-red-500 dark:text-red-400">*</span></label>
                  <input type="text" name="kbName" id="kbName" value={newKbName} onChange={e => setNewKbName(e.target.value)} required className="block w-full px-3 py-2 border border-gray-300 dark:border-dark-border dark:bg-dark-card dark:text-dark-text rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" placeholder="KB Name" />
                </div>
                <div>
                  <label htmlFor="kbDescription" className="block text-xs font-medium text-gray-600 dark:text-dark-muted mb-1">Description</label>
                  <textarea name="kbDescription" id="kbDescription" rows={2} value={newKbDescription} onChange={e => setNewKbDescription(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 dark:border-dark-border dark:bg-dark-card dark:text-dark-text rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm resize-none" placeholder="Optional description..." />
                </div>
                {kbCreateFetcher.data?.error && ( <p className="text-xs text-red-600 dark:text-red-400">{kbCreateFetcher.data.error}</p> )}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowKbForm(false)} className="px-4 py-2 border border-gray-300 dark:border-dark-border rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-dark-text bg-white dark:bg-dark-card hover:bg-gray-50 dark:hover:bg-dark-border focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-gray-500"> Cancel </button>
                  <button type="submit" disabled={isCreatingKb || !newKbName.trim()} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-blue-500 disabled:opacity-50"> {isCreatingKb ? (<><ArrowPathIcon className="animate-spin h-4 w-4 mr-2"/>Creating...</>) : "Create KB"} </button>
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
                             className="flex justify-between items-center p-3 rounded-md bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-dark-text hover:text-blue-700 dark:hover:text-blue-400 transition duration-150 ease-in-out group" // Flex applied here
                             prefetch="intent"
                             title={`View KB: ${kb.name}`}
                           >
                             {/* Use spans for content */}
                             <span className="flex flex-col min-w-0 mr-2">
                               <span className="font-medium text-sm truncate">{kb.name}</span>
                               <span className="text-xs text-gray-500 dark:text-gray-400 truncate italic">{kb.description || 'No description'}</span>
                             </span>
                             <ArrowRightIcon className="h-4 w-4 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex-shrink-0"/>
                           </Link>
                           {/* *** End Link *** */}
                         </li>
                     ) : null
                  ))}
                </ul>
             ) : (
                 !showKbForm && <p className="text-sm text-gray-500 dark:text-gray-400 italic text-center mt-4">No Knowledge Bases created yet.</p> // Show only if form is hidden
             )}
          </div>

          {/* Loader Error Display */}
          {loaderError && (
            <div className="bg-red-50 dark:bg-red-900/30 p-4 rounded-md border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 w-full mt-4">
              <strong>Error loading data:</strong> {typeof loaderError === 'string' ? loaderError : JSON.stringify(loaderError)}
            </div>
          )}

        </div>
      </div>
      {/* Footer */}
      <footer className="pt-8 text-sm text-gray-500 dark:text-gray-400 text-center">
            <p>Demo for Educational Purposes only</p>
            <p> Created by <em>Rodrigo Meza</em> for <strong><em>Grupo CASSA</em></strong> </p>
      </footer>
    </div>
  );
}