// frontend/app/routes/_index.tsx (Updated with Conversation List)

import { redirect, json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node"; // Added json, LoaderFunctionArgs
import { Form, useNavigation, useLoaderData, Link } from "@remix-run/react"; // Import useLoaderData, Link
import { createConversation, listConversations, type ConversationInfo } from "~/lib/apiClient"; // Import listConversations and type
import { ArrowPathIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'; // Optional icons

// --- Loader Function ---
// Fetches the initial list of conversations when visiting the root route
export async function loader({ request }: LoaderFunctionArgs) {
    try {
        // Fetch the first few conversations (e.g., latest 10)
        // The listConversations function uses skip=0, limit=5 by default
        const conversations = await listConversations(0, 10); // Fetch latest 10 initially
        return json({ conversations });
    } catch (error) {
        console.error("Failed to load conversations for root route:", error);
        // Return empty list on error or handle differently
        return json({ conversations: [] });
    }
}

// --- Action Function (Remains the same) ---
// Handles the "Start New Conversation" button click
export async function action({ request }: ActionFunctionArgs) {
  try {
    console.log("Root index action: Creating new conversation..."); // Add log here
    const newConv = await createConversation();
    if (newConv.id) {
      console.log("Root index action: Redirecting to:", `/chat/${newConv.id}`);
      return redirect(`/chat/${newConv.id}`);
    } else {
      throw new Error("Failed to get conversation ID (id field missing) from API");
    }
  } catch (error) {
    console.error("Root index action: Failed to create new conversation:", error);
    throw error;
  }
}

// --- Component ---
export default function Index() {
  const { conversations } = useLoaderData<typeof loader>(); // Get conversations from loader
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-green-50 p-6">
      <div className="bg-white p-8 rounded-lg shadow-md text-center max-w-md w-full mb-8"> {/* Added margin-bottom */}
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          Welcome to CassaGPT
        </h1>
        <p className="text-gray-600 mb-6">
          Start a new chat session to interact with the AI, upload documents, and get insights.
        </p>
        {/* Start New Conversation Form */}
        <Form method="post">
          <button
            type="submit"
            className={`w-full px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white
                       bg-green-600 hover:bg-green-700
                       focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition duration-150 ease-in-out`}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center">
                <ArrowPathIcon className="animate-spin h-5 w-5 mr-2" /> Starting...
              </span>
             ) : "Start New Conversation"}
          </button>
        </Form>
      </div>

      {/* Display Recent Conversations List */}
      {conversations && conversations.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md w-full max-w-md">
            <h2 className="text-lg font-semibold text-gray-700 mb-4 border-b pb-2">Recent Conversations</h2>
            <ul className="space-y-2">
                {conversations.map(conv => (
                    <li key={conv.id}>
                        <Link
                            to={`/chat/${conv.id}`}
                            className="block p-3 rounded-md text-sm bg-gray-50 hover:bg-gray-100 text-blue-600 hover:text-blue-800 transition duration-150 ease-in-out"
                            prefetch="intent"
                            title={`Chat from ${new Date(conv.created_at).toLocaleString()}`}
                        >
                            <span className="flex items-center gap-2">
                                <ChatBubbleLeftRightIcon className="h-4 w-4 flex-shrink-0 text-gray-400"/>
                                <span className="font-mono text-xs">ID: {conv.id.substring(0, 8)}...</span>
                                <span className="text-xs text-gray-500 ml-auto">({new Date(conv.created_at).toLocaleDateString()})</span>
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
            {/* Add pagination or "View All" link later if needed */}
        </div>
      )}

      <footer className="mt-8 text-sm text-gray-500">
            Powered by AI
      </footer>
    </div>
  );
}