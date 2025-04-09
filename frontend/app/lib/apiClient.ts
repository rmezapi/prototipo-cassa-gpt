// frontend/app/lib/apiClient.ts

// Get the base URL from environment variables
// Ensure VITE_API_BASE_URL is set in your frontend/.env file
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api"; // Fallback or default

if (!API_BASE_URL) {
  console.warn(
    "VITE_API_BASE_URL is not defined. API calls might fail or use relative paths."
  );
}

// --- Helper Function for API Requests ---
export async function fetchApi<T = any>( // Generic type T for response data
  endpoint: string,
  options: RequestInit = {} // Standard fetch options (method, headers, body)
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`; // Construct full URL

  // Default headers (can be overridden)
  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    Accept: "application/json",
    // Add Authorization headers later if needed
  };

  const config: RequestInit = {
    ...options, // Merge passed options
    headers: {
      ...defaultHeaders,
      ...options.headers, // Allow overriding default headers
    },
  };

  try {
    const response = await fetch(url, config);

    // Check if the response is successful (status code 2xx)
    if (!response.ok) {
      // Try to parse error details from the response body
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        // If parsing fails, use status text
        errorData = { detail: response.statusText };
      }
      // Throw an error object compatible with Remix's error handling
      throw new Response(
          errorData?.detail || `HTTP error ${response.status}`,
          { status: response.status }
        );
    }

    // Handle cases with no content expected (e.g., 204 No Content)
    if (response.status === 204) {
       return {} as T; // Return an empty object or adjust as needed
    }

    // Parse JSON response body
    const data: T = await response.json();
    return data;

  } catch (error) {
    console.error(`API call failed: ${endpoint}`, error);

    // Re-throw the error so it can be caught by Remix loaders/actions or component boundaries
    if (error instanceof Response) {
       // If it's already a Response object (from our !response.ok check), re-throw it
       throw error;
    } else if (error instanceof Error) {
       // Wrap other errors in a Response object for consistency
       throw new Response(error.message || "Network or unexpected error occurred", { status: 500 });
    } else {
        // Fallback for unknown errors
       throw new Response("An unknown error occurred", { status: 500 });
    }
  }
}

// --- Specific API Functions (Examples) ---

// Function to create a new conversation
export const createConversation = (): Promise<{ conversation_id: string }> => {
  return fetchApi<{ conversation_id: string }>("/chat/conversation", {
    method: "POST",
    body: JSON.stringify({}), // Send empty body if required by endpoint
  });
};

// Define types for chat request/response mirroring the backend Pydantic models
interface ChatRequestPayload {
    query: string;
    conversation_id: string;
}

interface ChatResponsePayload {
    response: string;
    conversation_id: string;
    sources: Array<{
        type: string;
        filename?: string;
        score?: number;
        text?: string;
    }>;
}

// Function to send a chat message
export const sendChatMessage = (payload: ChatRequestPayload): Promise<ChatResponsePayload> => {
    return fetchApi<ChatResponsePayload>("/chat", {
        method: "POST",
        body: JSON.stringify(payload),
    });
};

// Add function for file upload later (will need different headers/body)
// export const uploadFile = async (conversationId: string, file: File): Promise<any> => {
//     const formData = new FormData();
//     formData.append("conversation_id", conversationId);
//     formData.append("file", file);
//
//     // NOTE: Don't set Content-Type header when using FormData,
//     // the browser will set it correctly with the boundary.
//     return fetchApi<any>("/upload", {
//         method: "POST",
//         body: formData,
//         headers: {
//             // Remove default JSON headers for FormData
//             'Content-Type': undefined, // Let browser set it
//             'Accept': 'application/json', // We still expect JSON back
//         }
//     });
// }