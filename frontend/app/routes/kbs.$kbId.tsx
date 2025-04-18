// frontend/app/routes/kbs.$kbId.tsx

import { useState, useEffect, useRef, useCallback } from "react";
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
  if (!file || !(file instanceof File) || file.size === 0) { return json({ success: false, error: "No file or empty file uploaded.", document: null }, { status: 400 }); }
  try {
    console.log(`kbs.$kbId Action: Calling uploadDocumentToKb for "${file.name}"...`);
    // Type KbUploadResponsePayload should match { processed_files, failed_files, details: KBDocumentInfo[] }
    const result: KbUploadResponsePayload = await uploadDocumentToKb(kbId, file);

    // Check the 'details' array from the response
    if (result && result.details && result.details.length > 0) {
      const uploadedDocumentInfo = result.details[0]; // Get the first (and only) document info
      console.log(`kbs.$kbId Action: Upload successful (202 Accepted) for file "${uploadedDocumentInfo.filename}". DB ID: ${uploadedDocumentInfo.id}`);
      return json({ success: true, error: null, document: uploadedDocumentInfo }); // Return the specific document info
    } else {
      console.error("kbs.$kbId Action: API response OK (202) but missing expected details array or it was empty.", result);
      return json({ success: false, error: "Upload accepted by server, but initial document details were not returned.", document: null }, { status: 500 });
    }
  } catch (error: unknown) {
    console.error(`kbs.$kbId Action: Failed to upload document to KB ${kbId} (Caught Exception):`, error);
    if (error instanceof Response) { // Handle API Response errors
       try { const errorBody = await error.json(); return json({ success: false, error: errorBody?.detail || `Upload API Error (${error.status})`, document: null }, { status: error.status }); }
       catch(_) { return json({ success: false, error: error.statusText || `Upload API Error (${error.status})`, document: null }, { status: error.status }); }
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
  const isUploading = fetcher.state !== 'idle';
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
                    revalidator.revalidate();
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
  const handleUploadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
     event.preventDefault(); if (!selectedFile || isUploading || !kbDetails?.id) return;
     processedFetcherDocId.current = null; // Reset processed ID before new submit
     const formData = new FormData(); formData.append("file", selectedFile);
     fetcher.submit(formData, { method: "post", encType: "multipart/form-data", action: `/kbs/${kbDetails.id}` });
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
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
        {/* Back Link and Title */}
        <div className="mb-6 pb-4 border-b border-gray-200">
            <nav className="mb-6">
            <Link to="/" className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-800 mb-2">
                <HomeIcon className="h-4 w-4 mr-1"/>  Home
            </Link>
            </nav>
            <Link to="/kbs" className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-800 mb-2"> <ChevronLeftIcon className="h-4 w-4 mr-1" /> More Knowledge Bases </Link>
            <h1 className="text-xl md:text-2xl font-semibold text-gray-800 flex items-center"> <CircleStackIcon className="h-6 w-6 mr-2 text-blue-600 flex-shrink-0" /> <span className="truncate">{kbDetails.name}</span> </h1>
            {kbDetails.description && ( <p className="mt-1 text-sm text-gray-500">{kbDetails.description}</p> )}
            <p className="mt-1 text-xs text-gray-400">ID: {kbDetails.id}</p>
        </div>

        {/* Guidance Message */}
        {needsFirstDocument && (
            <div className="mb-6 p-4 border-l-4 border-blue-400 bg-blue-50 rounded-r-lg shadow-sm">
                <div className="flex"> <div className="flex-shrink-0"> <InformationCircleIcon className="h-5 w-5 text-blue-400" aria-hidden="true" /> </div> <div className="ml-3"> <p className="text-sm text-blue-700"> This Knowledge Base is empty. Upload your first document below to enable context retrieval for linked chats. </p> </div> </div>
            </div>
        )}

        {/* Document Upload Section */}
        <div className="mb-8 bg-white p-4 rounded-lg shadow border border-gray-200">
          <h2 className="text-lg font-medium text-gray-700 mb-3">Upload Document</h2>
          <fetcher.Form onSubmit={handleUploadSubmit} encType="multipart/form-data" className="space-y-4">
              <div> <label htmlFor="file-upload" className="sr-only">Choose file</label> <input ref={fileInputRef} id="file-upload" name="kb-doc-input" type="file" onChange={handleFileChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50" disabled={isUploading} accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif"/> </div>
              {selectedFile && !isUploading && ( <p className="text-sm text-gray-600">Selected: {selectedFile.name}</p> )}
              <div className="flex items-center justify-between">
                <button type="submit" disabled={!selectedFile || isUploading} className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 transition"> {isUploading ? (<><ArrowPathIcon className="animate-spin h-4 w-4 mr-2"/>Uploading...</>) : (<><ArrowUpTrayIcon className="h-4 w-4 mr-2"/>Upload File</>)} </button>
                {fetcher.data?.error && !isUploading && ( <p className="text-sm text-red-600 ml-4">{fetcher.data.error}</p> )}
              </div>
          </fetcher.Form>
        </div>

        {/* Documents List Section */}
        <div>
           <h2 className="text-lg font-medium text-gray-700 mb-3">Documents</h2>
           {(kbDetails.documents?.length ?? 0) === 0 ? ( // Safer check for empty/undefined
                <div className="text-center py-8 px-4 border border-dashed border-gray-300 rounded-lg bg-gray-50">
                  <DocumentIcon className="mx-auto h-8 w-8 text-gray-400" /> <h3 className="mt-2 text-sm font-medium text-gray-900">No Documents Yet</h3> <p className="mt-1 text-sm text-gray-500">Upload documents using the form above.</p>
                </div>
           ) : (
                <div className="bg-white shadow border border-gray-200 overflow-hidden sm:rounded-md">
                  <ul role="list" className="divide-y divide-gray-200">
                    {kbDetails.documents
                        .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()) // Sort newest first
                        .map((doc) => (
                      <li key={doc.id} className="px-4 py-3 sm:px-6 hover:bg-gray-50 transition">
                        <div className="flex items-center justify-between space-x-4">
                          <div className="flex items-center space-x-3 min-w-0">
                             {renderStatusIcon(doc.status)}
                             <p className="text-sm font-medium text-gray-800 truncate" title={doc.filename}> {doc.filename} </p>
                          </div>
                          <div className="flex items-center space-x-4 flex-shrink-0 text-sm text-gray-500">
                              {doc.status === 'error' && doc.error_message && ( <ExclamationTriangleIcon className="h-5 w-5 text-red-400 flex-shrink-0" title={`Error: ${doc.error_message}`} /> )}
                              <span className="flex items-center" title={new Date(doc.uploaded_at).toString()}> <ClockIcon className="h-4 w-4 mr-1 text-gray-400" /> {new Date(doc.uploaded_at).toLocaleString()} </span>
                          </div>
                        </div>
                        {doc.status === 'error' && doc.error_message && ( <p className="mt-1 pl-8 text-xs text-red-600">{doc.error_message}</p> )}
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
  console.error(`Error Boundary for kbs/${params.kbId || 'unknown'}:`, error);
  let status = 500; let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    status = error.status;
    try { // Attempt to parse detail from common error structures
       const errorData = typeof error.data === 'string' ? JSON.parse(error.data) : error.data;
       message = errorData?.detail || errorData?.message || error.statusText || `Request failed with status ${status}`;
    } catch(e) { message = error.data || error.statusText || `Request failed with status ${status}`; }
  } else if (error instanceof Error) { message = error.message; }

  return (
     <div className="p-4 md:p-6 max-w-4xl mx-auto text-center">
        <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-red-400" />
        <h1 className="mt-2 text-xl font-semibold text-red-800">Error {status}</h1>
        <p className="mt-2 text-sm text-red-700">{message}</p>
        <div className="mt-6"> <Link to="/kbs" className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"> Back to Knowledge Bases </Link> </div>
     </div>
  );
}