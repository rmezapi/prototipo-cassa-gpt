// app/routes/chat.conversations.tsx

import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node"; // or cloudflare/deno

import { listConversations } from "~/lib/apiClient"; // Adjust path if needed
import { CONVERSATION_LOAD_LIMIT } from "~/routes/chat.$conversationId"; // Or define the limit here

// This loader handles requests to /chat/conversations.data?...
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const skip = parseInt(url.searchParams.get("skip") || "0", 10);
  // Use the same limit as defined in your component or define it centrally
  const limit = parseInt(url.searchParams.get("limit") || `${CONVERSATION_LOAD_LIMIT}`, 10);

  console.log(`Loader [/chat/conversations]: Fetching conversations skip=${skip}, limit=${limit}`);

  try {
    // Assuming listConversations takes skip and limit parameters
    // Adjust the call based on your actual API client function signature
    const conversations = await listConversations({ skip, limit });

    // Return the data (or an empty array if null/undefined)
    return json({ conversations: conversations ?? [] });

  } catch (error: any) {
    console.error("Loader Error [/chat/conversations]:", error);
    // Return an error structure that your sidebarFetcher effect can handle
    return json({ error: error.message || "Failed to load conversations" }, { status: 500 });
  }
}

// Optional: Since this route is often just for data,
// you might not need a default component export.
// If Remix requires one, you can add a minimal one:
// export default function ConversationsDataRoute() {
//   return null; // Or <Outlet /> if it could have child routes, unlikely here
// }