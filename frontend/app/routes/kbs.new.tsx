// frontend/app/routes/kbs.new.tsx

import { useState } from 'react';
import { json, redirect, type ActionFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useNavigation, Link } from "@remix-run/react";
import { createKnowledgeBase, type KnowledgeBaseInfo } from "~/lib/apiClient";
import { ArrowPathIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";

// Action: Handles the form submission to create a new KB
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const name = formData.get("kbName") as string;
  const description = formData.get("kbDescription") as string | null;

  // Basic validation
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return json({ error: "Knowledge Base name is required.", values: { name, description } }, { status: 400 });
  }

  try {
    console.log(`kbs.new Action: Creating KB with name: ${name}`);
    const newKb = await createKnowledgeBase({ name: name.trim(), description: description?.trim() || null });

    if (newKb && newKb.id) {
      console.log(`kbs.new Action: KB created successfully with ID: ${newKb.id}. Redirecting...`);
      // Redirect to the detail page of the newly created KB
      return redirect(`/kbs/${newKb.id}`);
    } else {
      console.error("kbs.new Action: API did not return a valid KB object with ID.");
      return json({ error: "Failed to create knowledge base: Invalid response from server.", values: { name, description } }, { status: 500 });
    }
  } catch (error: unknown) {
    console.error("kbs.new Action: Failed to create knowledge base:", error);
    let errorMessage = "An unexpected error occurred.";
    let status = 500;

    // Handle API Response errors
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

    // Return error and submitted values to repopulate form
    return json({ error: errorMessage, values: { name, description } }, { status });
  }
}

// Component: Renders the form for creating a new KB
export default function NewKnowledgeBase() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Keep track of input values for controlled components (optional but good practice)
  // Use actionData.values to repopulate form on error
  const [name, setName] = useState(actionData?.values?.name || '');
  const [description, setDescription] = useState(actionData?.values?.description || '');

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Back Link */}
       <Link
         to="/kbs" // Link back to the KB list
         className="inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-800 mb-4"
       >
         <ChevronLeftIcon className="h-4 w-4 mr-1" />
         Back to Knowledge Bases
       </Link>

      <h1 className="text-xl md:text-2xl font-semibold text-gray-800 mb-6">
        Create New Knowledge Base
      </h1>

      <Form method="post" className="space-y-6 bg-white p-6 rounded-lg shadow">
        {/* KB Name Input */}
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

        {/* KB Description Input */}
        <div>
          <label htmlFor="kbDescription" className="block text-sm font-medium text-gray-700">
            Description (Optional)
          </label>
          <div className="mt-1">
            <textarea
              id="kbDescription"
              name="kbDescription"
              rows={3}
              value={description || ''} // Ensure value is not null/undefined
              onChange={(e) => setDescription(e.target.value)}
              className="shadow-sm focus:ring-blue-500 focus:border-blue-500 block w-full sm:text-sm border border-gray-300 rounded-md resize-none"
              placeholder="Describe the purpose or content of this knowledge base..."
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            A brief description helps identify the knowledge base later.
          </p>
        </div>

        {/* Action Error Display */}
        {actionData?.error && (
            <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md border border-red-200" role="alert">
              {actionData.error}
            </p>
        )}

        {/* Submit Button */}
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