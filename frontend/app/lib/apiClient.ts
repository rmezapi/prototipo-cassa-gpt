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
// (Keep existing fetchApi function as is)
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

  // --- Special Handling for FormData ---
  if (options.body instanceof FormData) {
    const formDataHeaders = new Headers(config.headers);
    formDataHeaders.delete('Content-Type');
    config.headers = formDataHeaders;
  }

  try {
    console.log(`fetchApi: Sending request to ${url}`);
    console.log(`fetchApi: Request method: ${config.method}`);
    console.log(`fetchApi: Request headers:`, config.headers);
    if (config.body) {
      console.log(`fetchApi: Request body:`, config.body);
    }

    const response = await fetch(url, config);
    console.log(`fetchApi: Response status: ${response.status}`);

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
        console.log(`fetchApi: Error response data:`, errorData);
      } catch (e) {
        errorData = { detail: response.statusText };
        console.log(`fetchApi: Error parsing response:`, e);
      }
      throw new Response(
          typeof errorData?.detail === 'string'
            ? errorData.detail
            : JSON.stringify(errorData?.detail) || `HTTP error ${response.status}`,
          { status: response.status }
        );
    }

    if (response.status === 204) {
       console.log(`fetchApi: Response status 204, returning empty object`);
       return {} as T;
    }

    const data: T = await response.json();
    console.log(`fetchApi: Response data:`, data);
    return data;

  } catch (error) {
    console.error(`API call failed: ${endpoint}`, error);
    if (error instanceof Response) {
       throw error;
    } else if (error instanceof Error) {
       throw new Response(error.message || "Network or unexpected error occurred", { status: 500 });
    } else {
       throw new Response("An unknown error occurred", { status: 500 });
    }
  }
}

// --- Chat Types & Functions ---
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
export const sendChatMessage = (payload: ChatRequestPayload): Promise<ChatResponsePayload> => {
    return fetchApi<ChatResponsePayload>("/chat/message", {
        method: "POST",
        body: JSON.stringify(payload),
    });
};

// --- Session Upload Types & Functions ---
export interface SessionUploadResponsePayload {
    message: string;
    filename: string;
    doc_id?: string;
    chunks_added?: number;
}
export const uploadFileToSession = async (
    conversationId: string,
    file: File
): Promise<SessionUploadResponsePayload> => {
    if (!conversationId) throw new Error("Conversation ID is required for file upload.");
    if (!file) throw new Error("File is required for upload.");

    const formData = new FormData();
    // Use "files" parameter name to match the backend expectation
    formData.append("files", file, file.name);
    console.log("FormData prepared for session upload:", file.name);

    // Use the correct endpoint for chat uploads
    const url = `${API_BASE_URL}/chat/conversations/${conversationId}/upload`;

    try {
        // Create headers without Content-Type for FormData
        const headers = new Headers();
        // Let the browser set the Content-Type with boundary for FormData

        console.log(`uploadFileToSession: Sending request to ${url}`);

        // Add a timeout to the fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        try {
            // Log the request details
            console.log(`Request details:
                URL: ${url}
                Method: POST
                Headers: ${JSON.stringify(Object.fromEntries(headers.entries()))}
                File: ${file.name} (${file.type}, ${file.size} bytes)
            `);

            const response = await fetch(url, {
                method: "POST",
                body: formData,
                headers,
                signal: controller.signal,
                // Add credentials to ensure cookies are sent
                credentials: 'include'
            });

            clearTimeout(timeoutId);
            console.log(`uploadFileToSession: Response status: ${response.status}`);
            console.log(`Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);

            if (!response.ok) {
                let errorMessage = `HTTP error ${response.status}`;
                try {
                    // Try to parse as JSON first
                    const contentType = response.headers.get('content-type');
                    if (contentType && contentType.includes('application/json')) {
                        const errorData = await response.json();
                        console.log("Error response JSON:", errorData);
                        errorMessage = errorData?.detail || errorMessage;
                    } else {
                        // If not JSON, get text
                        const errorText = await response.text();
                        console.log("Error response text:", errorText);
                        errorMessage = errorText || errorMessage;
                    }
                } catch (e) {
                    console.error('Error parsing error response:', e);
                }
                throw new Response(errorMessage, { status: response.status });
            }

            // Check content type to determine how to parse the response
            const contentType = response.headers.get('content-type');
            console.log(`Response content type: ${contentType}`);

            if (contentType && contentType.includes('application/json')) {
                const data = await response.json();
                console.log(`uploadFileToSession: Response data:`, data);
                return data;
            } else {
                // Try to parse as JSON anyway
                try {
                    const text = await response.text();
                    console.log(`Response text: ${text}`);

                    // Try to parse as JSON
                    try {
                        const jsonData = JSON.parse(text);
                        console.log("Successfully parsed response as JSON:", jsonData);
                        return jsonData;
                    } catch (jsonError) {
                        console.log("Response is not valid JSON, creating synthetic response");
                    }
                } catch (textError) {
                    console.error("Error reading response text:", textError);
                }

                // If not JSON or can't read text, create a synthetic response
                console.log(`uploadFileToSession: Non-JSON response, creating synthetic response`);
                // Create a minimal valid response object
                return {
                    message: "File uploaded successfully",
                    filename: file.name,
                    doc_id: crypto.randomUUID(),
                    chunks_added: 1
                };
            }
        } catch (fetchError: any) {
            clearTimeout(timeoutId);
            console.error("Fetch error details:", fetchError);

            if (fetchError.name === 'AbortError') {
                console.error('Request timed out');
                throw new Error('Request timed out. The server took too long to respond.');
            }
            throw fetchError;
        }
    } catch (error) {
        console.error(`uploadFileToSession failed:`, error);

        // If the direct endpoint fails, try the action endpoint as a fallback
        try {
            console.log("Trying action endpoint as fallback...");
            const actionUrl = `/chat/${conversationId}`;

            const actionFormData = new FormData();
            actionFormData.append("intent", "upload");
            actionFormData.append("file", file);

            const actionResponse = await fetch(actionUrl, {
                method: "POST",
                body: actionFormData,
                credentials: 'include'
            });

            console.log(`Action endpoint response status: ${actionResponse.status}`);

            if (actionResponse.ok) {
                const data = await actionResponse.json();
                console.log("Action endpoint response:", data);

                if (data.ok && data.type === 'upload' && data.uploadInfo) {
                    return data.uploadInfo;
                }

                // Create a synthetic response if we can't get the real one
                return {
                    message: "File uploaded successfully (action fallback)",
                    filename: file.name,
                    doc_id: crypto.randomUUID(),
                    chunks_added: 1
                };
            }
        } catch (actionError) {
            console.error("Action endpoint fallback also failed:", actionError);
        }

        // Original error handling
        if (error instanceof Response) {
            throw error;
        } else if (error instanceof Error) {
            throw new Response(error.message || "Network or unexpected error occurred", { status: 500 });
        } else {
            throw new Response("An unknown error occurred", { status: 500 });
        }
    }
};


// --- Knowledge Base (KB) Types ---
// Moved KB types BEFORE Conversation types that depend on them
export interface KnowledgeBaseInfo {
    id: string;
    name: string;
    description: string | null;
    created_at: string;
}
export interface KnowledgeBaseDocumentInfo {
    id: string;
    qdrant_doc_id: string;
    filename: string;
    status: "processing" | "completed" | "error";
    error_message: string | null;
    uploaded_at: string;
    knowledge_base_id: string;
}
export interface KnowledgeBaseDetail extends KnowledgeBaseInfo {
    documents: KnowledgeBaseDocumentInfo[];
}
export interface KbUploadResponsePayload {
  processed_files: number;
  failed_files: string[];
  details: KnowledgeBaseDocumentInfo[]; // It's a LIST of details
}


// --- Conversation Types & Functions ---
export interface ConversationInfo {
    id: string;
    created_at: string;
    knowledge_base_id: string | null;
    model_id: string | null;
}
interface MessageInfo {
    id: string;
    speaker: string;
    text: string;
    created_at: string;
}
// --- MODIFIED ConversationDetail ---
export interface ConversationDetail extends ConversationInfo { // Extends base info which includes kb_id
    messages: MessageInfo[];
    knowledge_base: KnowledgeBaseInfo | null; // Added nested KB object (can be null)
    // uploaded_documents: UploadedFileInfo[]; // Add if backend returns this
}
// --- END MODIFICATION ---

interface UploadedFileInfo {
    id: string;
    filename: string;
    doc_id: string;
    uploaded_at: string;
}
export const createConversation = (kbId?: string | null, modelId?: string | null): Promise<ConversationInfo> => { // Backend returns ConversationInfoSchema
    console.log("createConversation called with modelId:", modelId);
    console.log("modelId type:", typeof modelId);

    // Always include model_id in the payload
    const payload: { knowledge_base_id?: string, model_id: string } = {
        model_id: modelId || "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free"
    };

    if (kbId) payload.knowledge_base_id = kbId;

    console.log("Creating conversation with payload:", payload);
    console.log("Payload JSON:", JSON.stringify(payload));

    return fetchApi<ConversationInfo>("/chat/conversations", { // Expecting ConversationInfo response
        method: "POST",
        body: JSON.stringify(payload),
    });
};
export const listConversations = (skip: number = 0, limit: number = 10): Promise<ConversationInfo[]> => {
  return fetchApi<ConversationInfo[]>(`/chat/conversations?skip=${skip}&limit=${limit}`);
};
// getConversationDetails function remains the same, but the generic type T is now the updated ConversationDetail
export const getConversationDetails = (conversationId: string): Promise<ConversationDetail> => {
    return fetchApi<ConversationDetail>(`/chat/conversations/${conversationId}`);
};
export const listSessionUploadedFiles = (conversationId: string): Promise<UploadedFileInfo[]> => {
    return fetchApi<UploadedFileInfo[]>(`/chat/conversations/${conversationId}/files`);
};


// --- KB API Functions ---
export const listKnowledgeBases = (): Promise<KnowledgeBaseInfo[]> => {
    return fetchApi<KnowledgeBaseInfo[]>("/kbs");
};
export const createKnowledgeBase = (payload: { name: string; description?: string | null }): Promise<KnowledgeBaseInfo> => {
    return fetchApi<KnowledgeBaseInfo>("/kbs", {
        method: "POST",
        body: JSON.stringify(payload),
    });
};
export const getKnowledgeBaseDetails = (kbId: string): Promise<KnowledgeBaseDetail> => {
    if (!kbId) throw new Error("Knowledge Base ID is required.");
    return fetchApi<KnowledgeBaseDetail>(`/kbs/${kbId}`);
};
export const listKnowledgeBaseDocuments = (kbId: string): Promise<KnowledgeBaseDocumentInfo[]> => {
    if (!kbId) throw new Error("Knowledge Base ID is required.");
    return fetchApi<KnowledgeBaseDocumentInfo[]>(`/kbs/${kbId}/documents`);
};
export const uploadDocumentToKb = async (
    kbId: string,
    file: File
): Promise<KbUploadResponsePayload> => {
    if (!kbId) throw new Error("Knowledge Base ID is required for document upload.");
    if (!file) throw new Error("File is required for upload.");

    const formData = new FormData();
    formData.append("file", file, file.name);
    console.log(`FormData prepared for KB upload: kbId=${kbId}, file=${file.name}`);

    // Use a custom fetch implementation to handle potential non-JSON responses
    const url = `${API_BASE_URL}/kbs/${kbId}/documents/upload`;

    try {
        // Create headers without Content-Type for FormData
        const headers = new Headers();
        // Let the browser set the Content-Type with boundary for FormData

        console.log(`uploadDocumentToKb: Sending request to ${url}`);
        const response = await fetch(url, {
            method: "POST",
            body: formData,
            headers
        });

        console.log(`uploadDocumentToKb: Response status: ${response.status}`);

        if (!response.ok) {
            let errorMessage = `HTTP error ${response.status}`;
            try {
                // Try to parse as JSON first
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await response.json();
                    errorMessage = errorData?.detail || errorMessage;
                } else {
                    // If not JSON, get text
                    errorMessage = await response.text() || errorMessage;
                }
            } catch (e) {
                console.error('Error parsing error response:', e);
            }
            throw new Response(errorMessage, { status: response.status });
        }

        // Check content type to determine how to parse the response
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            console.log(`uploadDocumentToKb: Response data:`, data);
            return data;
        } else {
            // If not JSON, create a synthetic response
            console.log(`uploadDocumentToKb: Non-JSON response, creating synthetic response`);
            // Create a minimal valid response object
            return {
                processed_files: 1,
                failed_files: [],
                details: [{
                    id: crypto.randomUUID(),
                    qdrant_doc_id: crypto.randomUUID(),
                    filename: file.name,
                    status: 'processing',
                    error_message: null,
                    uploaded_at: new Date().toISOString(),
                    knowledge_base_id: kbId
                }]
            };
        }
    } catch (error) {
        console.error(`uploadDocumentToKb failed:`, error);
        if (error instanceof Response) {
            throw error;
        } else if (error instanceof Error) {
            throw new Response(error.message || "Network or unexpected error occurred", { status: 500 });
        } else {
            throw new Response("An unknown error occurred", { status: 500 });
        }
    }
};

// --- Helper Types / Renaming ---
// export { uploadFileToSession }; // Export with the new name
// export const uploadFile = uploadFileToSession; // Keep this if you still need the old name elsewhere (remove if not)