// frontend/app/routes/_index.tsx
import type { MetaFunction } from "@remix-run/node"; // Corrected import
import { useState, useEffect, useRef, useCallback } from "react"; // Added useEffect, useRef, useCallback
// Import API client functions
import { createConversation, sendChatMessage } from "~/lib/apiClient"; // Adjust path if needed

export const meta: MetaFunction = () => {
  return [
    { title: "CassaGPT Prototype" },
    { name: "description", content: "Chat with CassaGPT!" },
  ];
};

// Define Message interface for type safety
interface Message {
    id: string;
    speaker: 'user' | 'ai';
    text: string;
    sources?: Array<any>; // Add sources if needed from response
    isLoading?: boolean; // Optional: for showing loading indicator for AI response
}

// Basic styling (to be replaced by Tailwind later)
const chatContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh", // Full viewport height
  maxWidth: "800px", // Limit width for readability
  margin: "0 auto", // Center horizontally
  border: "1px solid #ccc", // Simple border
  boxSizing: "border-box",
};

const messageListStyle: React.CSSProperties = {
  flexGrow: 1, // Takes up available space
  overflowY: "auto", // Allows scrolling for messages
  padding: "1rem",
  borderBottom: "1px solid #ccc",
};

const inputAreaStyle: React.CSSProperties = {
  display: "flex",
  padding: "1rem",
  gap: "0.5rem", // Space between input and button
};

const inputStyle: React.CSSProperties = {
  flexGrow: 1, // Input takes remaining space
  padding: "0.5rem",
  border: "1px solid #ccc",
  borderRadius: "4px",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  border: "none",
  backgroundColor: "#007bff",
  color: "white",
  borderRadius: "4px",
  cursor: "pointer",
};
// Add styles for loading/error if needed


export default function Index() {
  const [messages, setMessages] = useState<Message[]>([ // Use Message interface
    // Initial welcome message can be added here or fetched if dynamic
    // { id: crypto.randomUUID(), speaker: 'ai', text: 'Welcome to CassaGPT! How can I help?' }
  ]);
  const [inputText, setInputText] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false); // Loading state for AI response
  const [error, setError] = useState<string | null>(null); // Error state

  const messagesEndRef = useRef<HTMLDivElement>(null); // Ref for scrolling

  // --- Task 3: Conversation Initiation ---
  useEffect(() => {
    // Function to fetch or create conversation ID
    const initializeConversation = async () => {
       console.log("Initializing conversation...");
       setError(null); // Clear previous errors
       try {
           // Check local storage first? Or always create new? For prototype, let's create new.
           const data = await createConversation();
           if (data.conversation_id) {
               setConversationId(data.conversation_id);
               // Add initial welcome message AFTER getting ID
               setMessages([{ id: crypto.randomUUID(), speaker: 'ai', text: 'Welcome! Conversation started.' }]);
               console.log("Conversation initialized, ID:", data.conversation_id);
           } else {
               throw new Error("Failed to retrieve conversation ID");
           }
       } catch (err: any) {
           console.error("Failed to initialize conversation:", err);
           setError(err?.message || "Failed to connect to the server.");
           // Handle error state in UI
       }
    };

    initializeConversation(); // Call on component mount

    // No cleanup needed for this effect
  }, []); // Empty dependency array ensures this runs only once on mount

  // Function to scroll to the bottom of the message list
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Scroll to bottom whenever messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- Task 4: Sending Messages ---
  const handleSendMessage = useCallback(async (event?: React.FormEvent) => {
    if (event) event.preventDefault(); // Prevent default form submission if called from form
    if (!inputText.trim() || !conversationId || isLoading) return; // Check for input, ID, and loading state

    const userMessageText = inputText.trim();
    const userMessageId = crypto.randomUUID(); // Generate unique ID for the user message

    // 1. Add user message to state immediately
    const newUserMessage: Message = {
        id: userMessageId,
        speaker: 'user',
        text: userMessageText,
    };
    setMessages((prevMessages) => [...prevMessages, newUserMessage]);
    setInputText(""); // Clear input
    setIsLoading(true); // Set loading state for AI response
    setError(null); // Clear previous errors

    // Add placeholder for AI response (optional, shows loading)
    const loadingMessageId = crypto.randomUUID();
    setMessages((prevMessages) => [
        ...prevMessages,
        { id: loadingMessageId, speaker: 'ai', text: '...', isLoading: true }
    ]);
    await new Promise(resolve => setTimeout(resolve, 50)); // Allow UI to update slightly
    scrollToBottom(); // Scroll after adding placeholders

    try {
      // 2. Call API to send message to backend
      console.log(`Sending to backend (Conv ID: ${conversationId}): ${userMessageText}`);
      const response = await sendChatMessage({
        query: userMessageText,
        conversation_id: conversationId,
      });

      // 3. Replace loading message with actual AI response
      setMessages((prevMessages) =>
        prevMessages.map((msg) =>
          msg.id === loadingMessageId
            ? { ...msg, text: response.response, sources: response.sources, isLoading: false }
            : msg
        )
      );
      console.log("Received AI response:", response.response);

    } catch (err: any) {
      console.error("Failed to send message or get response:", err);
      const errorMsg = err?.message || "Failed to get response from AI.";
      setError(errorMsg);
      // Update placeholder message to show error or add a new error message
      setMessages((prevMessages) =>
          prevMessages.map(msg =>
              msg.id === loadingMessageId
                  ? { ...msg, text: `Error: ${errorMsg}`, isLoading: false }
                  : msg
          )
      );
    } finally {
      setIsLoading(false); // Ensure loading is reset
    }
  }, [inputText, conversationId, isLoading]); // Include dependencies for useCallback


  return (
    <div style={chatContainerStyle}>
      <div style={messageListStyle}>
         {/* Display any general errors */}
         {error && <div style={{ color: 'red', marginBottom: '1rem' }}>Error: {error}</div>}

         {/* Render messages */}
        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: '0.75rem', textAlign: msg.speaker === 'user' ? 'right' : 'left' }}>
             <span style={{
                // Add visual cue for loading message?
                opacity: msg.isLoading ? 0.6 : 1,
                backgroundColor: msg.speaker === 'user' ? '#d1e7fd' : '#e2e3e5',
                padding: '0.5rem 0.75rem',
                borderRadius: '10px',
                display: 'inline-block',
                maxWidth: '80%',
                whiteSpace: 'pre-wrap', // Preserve line breaks in messages
                wordWrap: 'break-word', // Wrap long words
             }}>
                {msg.text}
                {/* Optionally display sources */}
                {msg.sources && msg.sources.length > 0 && (
                    <div style={{ fontSize: '0.75rem', marginTop: '5px', opacity: 0.7 }}>
                        Sources: {msg.sources.map(s => s.filename || 'history').join(', ')}
                    </div>
                )}
             </span>
          </div>
        ))}
        {/* Div to help scroll to bottom */}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} style={inputAreaStyle}>
        <input
          type="text"
          style={inputStyle}
          placeholder={isLoading ? "AI is thinking..." : "Type your message..."}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isLoading || !conversationId} // Disable input while loading or if no convo ID
        />
        <button
          type="submit"
          style={buttonStyle}
          disabled={isLoading || !inputText.trim() || !conversationId} // Disable button too
        >
            {isLoading ? "Wait..." : "Send"}
        </button>
        {/* TODO: Add File Upload Button here later */}
      </form>
    </div>
  );
}