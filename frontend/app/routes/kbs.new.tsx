// frontend/app/routes/kbs.new.tsx

import { useState, useRef } from 'react';
import { json, ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation, Link, useFetcher } from "@remix-run/react";
import { createKnowledgeBase, type KnowledgeBaseInfo } from "~/lib/apiClient";
import { ArrowPathIcon, ChevronLeftIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";

// Action: Handles the form submission to create a new KB
export async function action({ request }: ActionFunctionArgs) {
    const formData = await request.formData();
    const name = formData.get("kbName") as string;
    const description = formData.get("kbDescription") as string | null;
  
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return json({ error: "Knowledge Base name is required.", values: { name, description } }, { status: 400 });
    }
  
    try {
      const newKb = await createKnowledgeBase({ name: name.trim(), description: description?.trim() || null });
      if (newKb && newKb.id) {
        // Instead of redirecting, return the new KB info so the component can show the document upload UI.
        return json({ newKb, created: true });
      } else {
        return json(
          { error: "Failed to create knowledge base: Invalid response from server.", values: { name, description } },
          { status: 500 }
        );
      }
    } catch (error: unknown) {
      let errorMessage = "An unexpected error occurred.";
      let status = 500;
      if (error instanceof Response) {
        status = error.status;
        try {
          const errorBody = await error.json();
          errorMessage = errorBody?.detail || `API Error (${status})`;
        } catch (_) {
          errorMessage = error.statusText || `API Error (${status})`;
        }
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      return json({ error: errorMessage, values: { name, description } }, { status });
    }
  }

// Component: Renders the form for creating a new KB
export default function NewKnowledgeBase() {
    const actionData = useActionData<typeof action>();
    const navigation = useNavigation();
    const isSubmitting = navigation.state === "submitting";
  
    // Controlled inputs for KB creation
    const [name, setName] = useState(actionData?.values?.name || '');
    const [description, setDescription] = useState(actionData?.values?.description || '');
  
    // State to hold the created KB if the creation succeeded
    const [createdKB, setCreatedKB] = useState<KnowledgeBaseInfo | null>(
      actionData?.created ? actionData.newKb : null
    );
  
    // Fetcher for document uploads
    const docFetcher = useFetcher();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      setSelectedFile(file || null);
    };
  
    const handleUploadSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!selectedFile || !createdKB) return;
      const formData = new FormData();
      formData.append("file", selectedFile);
      // Calls the same upload endpoint as in kbs.$kbId.tsx
      docFetcher.submit(formData, { method: "post", encType: "multipart/form-data", action: `/kbs/${createdKB.id}/documents/upload` });
    };
  
    // If the KB was created, display the document upload UI
    if (createdKB) {
      return (
        <div className="p-4 md:p-6 max-w-2xl mx-auto">
          <Link to="/kbs" className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-800 mb-4">
            <ChevronLeftIcon className="h-4 w-4 mr-1" />
            Back to Knowledge Bases
          </Link>
          <h1 className="text-xl md:text-2xl font-semibold text-gray-800 mb-6">
            {createdKB.name}
          </h1>
          <p className="mb-6 text-gray-600">
            Your Knowledge Base has been created. You can now add documents below.
          </p>
          <div className="mb-8 bg-white p-4 rounded-lg shadow border border-gray-200">
            <h2 className="text-lg font-medium text-gray-700 mb-3">Upload Document</h2>
            <docFetcher.Form onSubmit={handleUploadSubmit} encType="multipart/form-data" className="space-y-4">
              <div>
                <label htmlFor="file-upload" className="sr-only">Choose file</label>
                <input
                  ref={fileInputRef}
                  id="file-upload"
                  name="file"
                  type="file"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  accept=".pdf,.doc,.docx,.txt,.md,.csv"
                />
              </div>
              {selectedFile && (
                <p className="text-sm text-gray-600">Selected: {selectedFile.name}</p>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!selectedFile || docFetcher.state === "submitting"}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 transition"
                >
                  {docFetcher.state === "submitting" ? (
                    <>
                      <ArrowPathIcon className="animate-spin h-4 w-4 mr-2" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <ArrowUpTrayIcon className="h-4 w-4 mr-2" />
                      Upload Document
                    </>
                  )}
                </button>
                {docFetcher.data?.error && (
                  <p className="text-sm text-red-600 ml-4">{docFetcher.data.error}</p>
                )}
              </div>
            </docFetcher.Form>
          </div>
          <div>
            <Link to={`/kbs/${createdKB.id}`} className="text-blue-600 hover:underline text-sm">
              View Knowledge Base Details
            </Link>
          </div>
        </div>
      );
    }
  
    // Otherwise, render the KB creation form
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <Link to="/kbs" className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-800 mb-4">
          <ChevronLeftIcon className="h-4 w-4 mr-1" />
          Back to Knowledge Bases
        </Link>
        <h1 className="text-xl md:text-2xl font-semibold text-gray-800 mb-6">
          Create New Knowledge Base
        </h1>
        <Form method="post" className="space-y-6 bg-white p-6 rounded-lg shadow">
          <div>
            <label htmlFor="kbName" className="block text-sm font-medium text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <div className="mt-1">
              <input
                type="text"
                name="kbName"
                id="kbName"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border-gray-300 rounded-md"
                placeholder="e.g., Project Documentation, Team Policies"
              />
            </div>
          </div>
          <div>
            <label htmlFor="kbDescription" className="block text-sm font-medium text-gray-700">
              Description (Optional)
            </label>
            <div className="mt-1">
              <textarea
                id="kbDescription"
                name="kbDescription"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border border-gray-300 rounded-md resize-none"
                placeholder="Describe the purpose or content of this knowledge base..."
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              A brief description helps identify the knowledge base later.
            </p>
          </div>
          {actionData?.error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200" role="alert">
              {actionData.error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 transition ease-in-out duration-150"
            >
              {isSubmitting ? (
                <>
                  <ArrowPathIcon className="animate-spin h-4 w-4 mr-2" />
                  Creating...
                </>
              ) : (
                "Create Knowledge Base"
              )}
            </button>
          </div>
        </Form>
      </div>
    );
  }