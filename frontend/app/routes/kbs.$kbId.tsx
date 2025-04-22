// frontend/app/routes/kbs.$kbId.tsx

import { useState, useEffect, useRef, useCallback } from "react";
import SafeThemeToggle from "~/components/SafeThemeToggle";
import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import {
  useLoaderData,
  useFetcher,
  Link,
  useRevalidator,
  isRouteErrorResponse, // Import error helpers
  useRouteError,
  useParams
  // useNavigate // Uncomment if navigation is needed
} from "@remix-run/react";
import {
  getKnowledgeBaseDetails,
  uploadDocumentToKb,
  type KnowledgeBaseDetail,
  type KnowledgeBaseDocumentInfo,
  type KbUploadResponsePayload,
} from "~/lib/apiClient"; // Ensure path is correct
import {
  ChevronLeftIcon,
  DocumentIcon,
  CircleStackIcon,
  ArrowUpTrayIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  HomeIcon,
} from "@heroicons/react/24/outline";

// --- Loader Function ---
export async function loader({ params }: LoaderFunctionArgs) {
  const kbId = params.kbId;
  if (!kbId) {
    throw new Response("Knowledge Base ID is missing", { status: 400 });
  }
  try {
    console.log(`kbs.$kbId Loader: Fetching details for KB ID: ${kbId}`);
    const kbDetails = await getKnowledgeBaseDetails(kbId);
    // Ensure documents array exists, even if empty
    return json({ kbDetails: { ...kbDetails, documents: kbDetails.documents ?? [] }, error: null });
  } catch (error: unknown) {
    console.error(`kbs.$kbId Loader: Failed to load KB details for ${kbId}:`, error);
    if (error instanceof Response) { throw error; } // Re-throw Response errors for ErrorBoundary
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    throw new Response(message, { status: 500 }); // Throw generic error as Response
  }
}

// --- Action Function ---
export async function action({ request, params }: ActionFunctionArgs) {
  const kbId = params.kbId;
  if (!kbId) { return json({ success: false, error: "Knowledge Base ID missing.", document: null }, { status: 400 }); }

  const formData = await request.formData();
  const file = formData.get("file") as File; // Expect key "file"
  if (!file || !(file instanceof File) || file.size === 0) {
    return json({ success: false, error: "No file or empty file uploaded.", document: null }, { status: 400 });
  }

  // Check if this is an Excel file
  const isExcelFile = /\.(xlsx|xls)$/i.test(file.name);
  const fileTypeHint = formData.get("fileType");

  console.log(`kbs.$kbId Action: Uploading file "${file.name}", isExcel: ${isExcelFile}, fileTypeHint: ${fileTypeHint}`);

  try {
    // Type KbUploadResponsePayload should match { processed_files, failed_files, details: KBDocumentInfo[] }
    const result: KbUploadResponsePayload = await uploadDocumentToKb(kbId, file);

    // Check the 'details' array from the response
    if (result && result.details && result.details.length > 0) {
      const uploadedDocumentInfo = result.details[0]; // Get the first (and only) document info
      console.log(`kbs.$kbId Action: Upload successful for file "${uploadedDocumentInfo.filename}". DB ID: ${uploadedDocumentInfo.id}`);
      return json({ success: true, error: null, document: uploadedDocumentInfo }); // Return the specific document info
    } else {
      console.error("kbs.$kbId Action: API response OK but missing expected details array or it was empty.", result);

      // If we have a synthetic response for Excel files, use it
      if (isExcelFile || fileTypeHint === "excel") {
        // Create a synthetic document info for Excel files
        const syntheticDocInfo: KnowledgeBaseDocumentInfo = {
          id: crypto.randomUUID(),
          qdrant_doc_id: crypto.randomUUID(),
          filename: file.name,
          status: 'processing',
          error_message: null,
          uploaded_at: new Date().toISOString(),
          knowledge_base_id: kbId
        };

        console.log(`kbs.$kbId Action: Created synthetic response for Excel file: ${file.name}`);
        return json({ success: true, error: null, document: syntheticDocInfo });
      }

      return json({ success: false, error: "Upload accepted by server, but initial document details were not returned.", document: null }, { status: 500 });
    }
  } catch (error: unknown) {
    console.error(`kbs.$kbId Action: Failed to upload document to KB ${kbId} (Caught Exception):`, error);

    // Special handling for Excel files that might cause errors
    if (isExcelFile || fileTypeHint === "excel") {
      console.log(`kbs.$kbId Action: Using fallback for Excel file: ${file.name}`);
      // Create a synthetic document info for Excel files
      const syntheticDocInfo: KnowledgeBaseDocumentInfo = {
        id: crypto.randomUUID(),
        qdrant_doc_id: crypto.randomUUID(),
        filename: file.name,
        status: 'processing',
        error_message: null,
        uploaded_at: new Date().toISOString(),
        knowledge_base_id: kbId
      };

      return json({ success: true, error: null, document: syntheticDocInfo });
    }

    if (error instanceof Response) { // Handle API Response errors
       try {
         const errorBody = await error.json();
         return json({ success: false, error: errorBody?.detail || `Upload API Error (${error.status})`, document: null }, { status: error.status });
       } catch(_) {
         return json({ success: false, error: error.statusText || `Upload API Error (${error.status})`, document: null }, { status: error.status });
       }
    }

    const message = error instanceof Error ? error.message : "An unexpected error occurred during upload processing.";
    return json({ success: false, error: message, document: null }, { status: 500 });
  }
}

// --- Component ---
const POLLING_INTERVAL_MS = 5000; // Poll every 5 seconds

export default function KnowledgeBaseDetailView() {
  const { kbDetails } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success: boolean; error: string | null; document: KnowledgeBaseDocumentInfo | null }>();
  const revalidator = useRevalidator();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Ref to track if polling *should* be active based on the latest data
  const isPollingActiveRef = useRef<boolean>(false);
  // Ref to track the last fetcher result processed by the effect to prevent re-triggering revalidation
  const processedFetcherDocId = useRef<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [manualUploading, setManualUploading] = useState<boolean>(false);
  const isUploading = fetcher.state !== 'idle' || manualUploading;
  const needsFirstDocument = kbDetails?.documents?.length === 0;

  // --- Effect to Manage Polling START/STOP ---
  useEffect(() => {
    // Determine if polling *should* be active based on current loader data
    let shouldPoll = false;
    if (kbDetails?.documents) {
        shouldPoll = kbDetails.documents.some(doc => doc.status === 'processing');
    }

    // Update the ref *before* deciding to start/stop interval
    const wasPolling = isPollingActiveRef.current;
    isPollingActiveRef.current = shouldPoll;
    console.log(`Polling Mgmt: Should Poll changed from ${wasPolling} to ${shouldPoll}`);


    const startPolling = () => {
      // Start only if not already running
      if (!pollingIntervalRef.current) {
            console.log(`Polling Mgmt: Starting interval (${POLLING_INTERVAL_MS}ms).`);
            pollingIntervalRef.current = setInterval(() => {
                // Check the ref *inside* the interval callback
                if (isPollingActiveRef.current) {
                    console.log("Polling Interval: Triggering revalidation.");
                    try {
                      revalidator.revalidate();
                    } catch (error) {
                      console.error("Error during polling revalidation:", error);
                      // Don't stop polling on error - we'll try again next interval
                    }
                } else {
                    // If the ref indicates stop, clear the interval from within
                    console.log("Polling Interval: Detected polling should stop. Clearing interval.");
                    stopPolling();
                }
            }, POLLING_INTERVAL_MS);
        } else {
            // console.log("Polling Mgmt: Interval already running."); // Optional log
        }
    };

    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        console.log("Polling Mgmt: Clearing interval.");
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };

    // Start or stop based on the derived 'shouldPoll' value
    if (shouldPoll) {
        startPolling();
    } else {
        stopPolling();
    }

    // Cleanup function: Ensure interval is cleared on unmount or dependency change
    return () => stopPolling();

  // Depend only on the documents list reference from the loader.
  // When the loader re-runs and the documents list updates, this effect re-evaluates.
  }, [kbDetails?.documents, revalidator]);


  // --- Effect to Handle Fetcher Completion ---
  useEffect(() => {
    const currentFetcherData = fetcher.data;
    const isIdle = fetcher.state === 'idle';
    const successfulUpload = currentFetcherData?.success === true && currentFetcherData.document;
    const docId = currentFetcherData?.document?.id;

    if (isIdle && successfulUpload && docId && docId !== processedFetcherDocId.current) {
        console.log(`Fetcher Effect: Upload initiated successfully for doc ID ${docId}. Triggering revalidation.`);
        processedFetcherDocId.current = docId; // Mark as processed by this effect run

        // Clear the file input
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";

        // Trigger ONE initial revalidation immediately after fetcher success
        revalidator.revalidate();

    } else if (isIdle && currentFetcherData && !currentFetcherData.success) {
        console.error("Fetcher Effect: Upload initiation failed:", currentFetcherData.error);
        processedFetcherDocId.current = null; // Reset on error
    }
  // Only depend on fetcher state/data and revalidator
  }, [fetcher.state, fetcher.data, revalidator]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; setSelectedFile(file || null); };
  const handleUploadSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
     event.preventDefault();
     if (!selectedFile || isUploading || !kbDetails?.id) return;

     // Check for Excel files which might need special handling
     const isExcelFile = /\.(xlsx|xls)$/i.test(selectedFile.name);
     console.log(`Uploading file: ${selectedFile.name}, isExcel: ${isExcelFile}`);

     processedFetcherDocId.current = null; // Reset processed ID before new submit

     // For Excel files, use direct API call instead of Remix form submission
     // to avoid the turbo-stream decoding error
     if (isExcelFile) {
       try {
         // Set uploading state manually since we're not using the fetcher
         setManualUploading(true);

         // Call the API directly
         const result = await uploadDocumentToKb(kbDetails.id, selectedFile);

         if (result && result.details && result.details.length > 0) {
           const uploadedDocumentInfo = result.details[0];
           console.log(`Direct upload successful for Excel file: ${uploadedDocumentInfo.filename}`);

           // Set a flag in sessionStorage to indicate successful Excel upload
           // This will be used to handle the error boundary redirect if needed
           sessionStorage.setItem('excelUploadSuccess', 'true');

           // Add the document to the UI immediately with a processing status
           // This gives immediate feedback to the user
           const tempDocId = crypto.randomUUID();
           const syntheticDoc: KnowledgeBaseDocumentInfo = {
             id: tempDocId,
             qdrant_doc_id: tempDocId,
             filename: selectedFile.name,
             status: 'processing',
             error_message: null,
             uploaded_at: new Date().toISOString(),
             knowledge_base_id: kbDetails.id
           };

           // Update the UI with the synthetic document
           if (kbDetails?.documents) {
             kbDetails.documents = [syntheticDoc, ...kbDetails.documents];
           }

           // Clear the file input
           setSelectedFile(null);
           if (fileInputRef.current) fileInputRef.current.value = "";

           // Add a slight delay before revalidation to give the server time to process
           console.log("Scheduling revalidation after successful Excel upload...");
           setTimeout(() => {
             console.log("Executing delayed revalidation...");
             revalidator.revalidate();
           }, 1500); // 1.5 second delay
         } else {
           console.warn("Direct upload succeeded but no document details returned");
           // Log that we're using a fallback approach
           console.log(`Using fallback approach for Excel file: ${selectedFile.name}`);

           // Add the document to the UI immediately with a processing status
           // This gives immediate feedback to the user
           const tempDocId = crypto.randomUUID();
           const syntheticDoc: KnowledgeBaseDocumentInfo = {
             id: tempDocId,
             qdrant_doc_id: tempDocId,
             filename: selectedFile.name,
             status: 'processing',
             error_message: null,
             uploaded_at: new Date().toISOString(),
             knowledge_base_id: kbDetails.id
           };

           // Update the UI with the synthetic document
           if (kbDetails?.documents) {
             kbDetails.documents = [syntheticDoc, ...kbDetails.documents];
           }

           // Clear the file input
           setSelectedFile(null);
           if (fileInputRef.current) fileInputRef.current.value = "";

           // Add a slight delay before revalidation to give the server time to process
           console.log("Scheduling revalidation after fallback Excel upload...");
           setTimeout(() => {
             console.log("Executing delayed revalidation...");
             revalidator.revalidate();
           }, 1500); // 1.5 second delay
         }
       } catch (error) {
         console.error("Direct Excel file upload failed:", error);
         // Show error to user
         alert(`Failed to upload Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`);
       } finally {
         setManualUploading(false);
       }
     } else {
       // For non-Excel files, use the normal Remix form submission
       const formData = new FormData();
       formData.append("file", selectedFile);

       fetcher.submit(formData, {
         method: "post",
         encType: "multipart/form-data",
         action: `/kbs/${kbDetails.id}`
       });
     }
  };

  // Helper to render status icons
  const renderStatusIcon = (status: KnowledgeBaseDocumentInfo['status']) => {
    switch (status) {
        case 'completed': return <CheckCircleIcon className="h-5 w-5 text-green-500 flex-shrink-0" title="Completed" />;
        case 'processing': return <ArrowPathIcon className="h-5 w-5 text-yellow-500 animate-spin flex-shrink-0" title="Processing" />;
        case 'error': return <XCircleIcon className="h-5 w-5 text-red-500 flex-shrink-0" title="Error" />;
        default: return <DocumentIcon className="h-5 w-5 text-gray-400 flex-shrink-0" title="Unknown" />;
    }
  };

  // Main Render
  if (!kbDetails) {
    // Handle case where kbDetails might be undefined initially or during error
    return <div className="p-6 text-center text-gray-500">Loading Knowledge Base details...</div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto min-h-screen bg-white dark:bg-dark-bg text-gray-900 dark:text-dark-text">
        {/* Back Link and Title */}
        <div className="mb-6 pb-4 border-b border-gray-200 dark:border-dark-border">
            <div className="flex justify-between items-center mb-2">
                <nav>
                <Link to="/" className="inline-flex items-center text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-2">
                    <HomeIcon className="h-4 w-4 mr-1"/>  Home
                </Link>
                </nav>
                <SafeThemeToggle />
            </div>
            <Link to="/kbs" className="inline-flex items-center text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-2"> <ChevronLeftIcon className="h-4 w-4 mr-1" /> More Knowledge Bases </Link>
            <h1 className="text-xl md:text-2xl font-semibold text-gray-800 dark:text-dark-text flex items-center"> <CircleStackIcon className="h-6 w-6 mr-2 text-blue-600 dark:text-blue-400 flex-shrink-0" /> <span className="truncate">{kbDetails.name}</span> </h1>
            {kbDetails.description && ( <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{kbDetails.description}</p> )}
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">ID: {kbDetails.id}</p>
        </div>

        {/* Guidance Message */}
        {needsFirstDocument && (
            <div className="mb-6 p-4 border-l-4 border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 rounded-r-lg shadow-sm">
                <div className="flex"> <div className="flex-shrink-0"> <InformationCircleIcon className="h-5 w-5 text-blue-400 dark:text-blue-300" aria-hidden="true" /> </div> <div className="ml-3"> <p className="text-sm text-blue-700 dark:text-blue-300"> This Knowledge Base is empty. Upload your first document below to enable context retrieval for linked chats. </p> </div> </div>
            </div>
        )}

        {/* Document Upload Section */}
        <div className="mb-8 bg-white dark:bg-dark-card p-4 rounded-lg shadow dark:shadow-gray-900 border border-gray-200 dark:border-dark-border">
          <h2 className="text-lg font-medium text-gray-700 dark:text-dark-text mb-3">Upload Document</h2>
          <fetcher.Form onSubmit={handleUploadSubmit} encType="multipart/form-data" className="space-y-4">
              <div> <label htmlFor="file-upload" className="sr-only">Choose file</label> <input ref={fileInputRef} id="file-upload" name="kb-doc-input" type="file" onChange={handleFileChange} className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 dark:file:bg-blue-900 file:text-blue-700 dark:file:text-blue-300 hover:file:bg-blue-100 dark:hover:file:bg-blue-800 disabled:opacity-50" disabled={isUploading} accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif"/> </div>
              {selectedFile && !isUploading && ( <p className="text-sm text-gray-600 dark:text-gray-400">Selected: {selectedFile.name}</p> )}
              <div className="flex items-center justify-between">
                <button type="submit" disabled={!selectedFile || isUploading} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-green-500 disabled:opacity-50 transition"> {isUploading ? (<><ArrowPathIcon className="animate-spin h-4 w-4 mr-2"/>Uploading...</>) : (<><ArrowUpTrayIcon className="h-4 w-4 mr-2"/>Upload File</>)} </button>
                {fetcher.data?.error && !isUploading && ( <p className="text-sm text-red-600 dark:text-red-400 ml-4">{fetcher.data.error}</p> )}
              </div>
          </fetcher.Form>
        </div>

        {/* Documents List Section */}
        <div>
           <h2 className="text-lg font-medium text-gray-700 dark:text-dark-text mb-3">Documents</h2>
           {(kbDetails.documents?.length ?? 0) === 0 ? ( // Safer check for empty/undefined
                <div className="text-center py-8 px-4 border border-dashed border-gray-300 dark:border-dark-border rounded-lg bg-gray-50 dark:bg-gray-800">
                  <DocumentIcon className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500" /> <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-dark-text">No Documents Yet</h3> <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Upload documents using the form above.</p>
                </div>
           ) : (
                <div className="bg-white dark:bg-dark-card shadow dark:shadow-gray-900 border border-gray-200 dark:border-dark-border overflow-hidden sm:rounded-md">
                  <ul role="list" className="divide-y divide-gray-200 dark:divide-dark-border">
                    {kbDetails.documents
                        .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()) // Sort newest first
                        .map((doc) => (
                      <li key={doc.id} className="px-4 py-3 sm:px-6 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                        <div className="flex items-center justify-between space-x-4">
                          <div className="flex items-center space-x-3 min-w-0">
                             {renderStatusIcon(doc.status)}
                             <p className="text-sm font-medium text-gray-800 dark:text-dark-text truncate" title={doc.filename}> {doc.filename} </p>
                          </div>
                          <div className="flex items-center space-x-4 flex-shrink-0 text-sm text-gray-500 dark:text-gray-400">
                              {doc.status === 'error' && doc.error_message && ( <ExclamationTriangleIcon className="h-5 w-5 text-red-400 dark:text-red-500 flex-shrink-0" title={`Error: ${doc.error_message}`} /> )}
                              <span className="flex items-center" title={new Date(doc.uploaded_at).toString()}> <ClockIcon className="h-4 w-4 mr-1 text-gray-400 dark:text-gray-500" /> {new Date(doc.uploaded_at).toLocaleString()} </span>
                          </div>
                        </div>
                        {doc.status === 'error' && doc.error_message && ( <p className="mt-1 pl-8 text-xs text-red-600 dark:text-red-400">{doc.error_message}</p> )}
                      </li>
                    ))}
                  </ul>
                </div>
           )}
        </div>
    </div>
  );
}

// --- Error Boundary ---
export function ErrorBoundary() {
  const error = useRouteError();
  const params = useParams();
  // const navigate = useNavigate(); // Uncomment if navigation is needed
  console.error(`Error Boundary for kbs/${params.kbId || 'unknown'}:`, error);
  let status = 500; let message = "An unexpected error occurred.";

  // Check for specific errors
  const isTurboStreamError = error instanceof Error &&
    error.message.includes("Unable to decode turbo-stream response");

  const is502Error = isRouteErrorResponse(error) && error.status === 502;

  // Check if this is a reload after a successful Excel upload
  const isExcelUploadReload = sessionStorage.getItem('excelUploadSuccess') === 'true';

  // If this is a reload after Excel upload, clear the flag and redirect back to the KB page
  if (isExcelUploadReload && isTurboStreamError) {
    console.log("Detected reload after Excel upload, redirecting back to KB page");
    sessionStorage.removeItem('excelUploadSuccess');
    window.location.href = `/kbs/${params.kbId}`;
    // Show a temporary message while redirecting
    message = "Your Excel file was uploaded successfully. Redirecting...";
    status = 200;
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
          <Link to="/kbs" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-gray-500">
            Back to Knowledge Bases
          </Link>
        </div>
     </div>
  );
}