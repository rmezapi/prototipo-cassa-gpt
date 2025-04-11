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
export const createConversation = (): Promise<{ id: string }> => {
  return fetchApi<{ id: string }>("/chat/conversations", {
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
    return fetchApi<ChatResponsePayload>("/chat/message", {
        method: "POST",
        body: JSON.stringify(payload),
    });
};

// Define response type from backend's /upload endpoint
// frontend/app/lib/apiClient.ts
interface UploadResponsePayload {
    message: string;
    filename: string;
    doc_id?: string;
    chunks_added?: number;
}

export const uploadFile = async (
    conversationId: string,
    file: File
): Promise<UploadResponsePayload> => {
    if (!conversationId) {
        // Add console log for debugging
        console.error("uploadFile called without conversationId");
        throw new Error("Conversation ID is required for file upload.");
    }
    if (!file) {
        // Add console log
        console.error("uploadFile called without file object");
        throw new Error("File is required for upload.");
    }

    // --- Create FormData ---
    const formData = new FormData();
    // Key must exactly match FastAPI's Form("conversation_id")
    formData.append("conversation_id", conversationId);
    // Key must exactly match FastAPI's File("file")
    formData.append("file", file, file.name);

    // --- Debugging: Log FormData content ---
    // Note: You can't directly log FormData easily, but you can check keys/values
    console.log("FormData prepared for upload:");
    for (let [key, value] of formData.entries()) {
        console.log(`  ${key}:`, value instanceof File ? `File(${value.name}, size=${value.size})` : value);
    }
    // --- End Debugging ---


    const url = `${API_BASE_URL}/upload`; // Construct URL here for clarity
    console.log(`Attempting POST to ${url}`);

    try {
        // --- Make the fetch call ---
        const response = await fetch(url, {
            method: "POST",
            body: formData,
            // **NO Content-Type header here - let the browser set it**
            headers: {
                // We *only* need 'Accept' if we strictly expect JSON back
                // If the backend might return non-JSON on error, even this isn't strictly needed
                'Accept': 'application/json',
                // Add any necessary Auth headers later
            }
        });

        // --- Process Response ---
        // Log status for debugging
        console.log(`Upload Response Status: ${response.status} ${response.statusText}`);

        // Check for non-OK status first
        if (!response.ok) {
            let errorData = { detail: `Upload failed with status ${response.status}` }; // Default error
            try {
                 // Try to parse JSON error body from FastAPI (like the 422 detail)
                errorData = await response.json();
                console.error("Parsed API Error Response:", errorData);
            } catch (e) {
                console.error("Failed to parse error response body, using status text.");
                errorData = { detail: response.statusText || `HTTP error ${response.status}` };
            }
            // Throw an error that includes the detail message
            throw new Error(
                typeof errorData.detail === 'string'
                ? errorData.detail // Use FastAPI's detail if it's a string
                : JSON.stringify(errorData.detail) // Stringify if complex (like the list)
            );
        }

        // Handle potential empty success response (though unlikely for this endpoint)
        if (response.status === 204) {
           return { message: "Upload successful (No Content)", filename: file.name } as UploadResponsePayload;
        }

        // Parse successful JSON response
        const data: UploadResponsePayload = await response.json();
        console.log("Parsed API Success Response:", data);
        return data;

    } catch (error) {
        // Log and re-throw wrapped error
        console.error(`Upload API call failed: ${url}`, error);
        // Ensure the message from the thrown error above is propagated
        const errorMessage = error instanceof Error ? error.message : "Network or unexpected upload error occurred";
        throw new Error(errorMessage); // Re-throw as a standard Error
    }
}

// --- Add types based on backend Pydantic models ---
export interface ConversationInfo { id: string; created_at: string; }
interface MessageInfo { id: string; speaker: string; text: string; created_at: string; }
interface ConversationDetail extends ConversationInfo { messages: MessageInfo[]; }
interface UploadedFileInfo { filename: string; doc_id: string; }

// Update listConversations to accept pagination params
export const listConversations = (skip: number = 0, limit: number = 5): Promise<ConversationInfo[]> => {
  // Append query parameters to the URL
  return fetchApi<ConversationInfo[]>(`/chat/conversations?skip=${skip}&limit=${limit}`);
};

export const getConversationDetails = (conversationId: string): Promise<ConversationDetail> => {
    return fetchApi<ConversationDetail>(`/chat/conversations/${conversationId}`);
};

export const listUploadedFiles = (conversationId: string): Promise<UploadedFileInfo[]> => {
    // Pointing to the placeholder endpoint for now
    return fetchApi<UploadedFileInfo[]>(`/chat/conversations/${conversationId}/files`);
};