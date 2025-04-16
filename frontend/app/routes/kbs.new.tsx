import { useState } from 'react';
import { json, ActionFunctionArgs, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation, Link } from "@remix-run/react";
import { createKnowledgeBase } from "~/lib/apiClient";
import { ArrowPathIcon, ChevronLeftIcon } from "@heroicons/react/24/outline";

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
        // Directly redirect to the KB detail page
        return redirect(`/kbs/${newKb.id}`);
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

    return (
      <div className="p-8 md:p-12 max-w-2xl mx-auto bg-gray-50 rounded-lg shadow-lg space-y-8">
        <Link to="/kbs" className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800">
          <ChevronLeftIcon className="h-5 w-5 mr-2" />
          Back to Knowledge Bases
        </Link>
        <h1 className="text-3xl font-bold text-gray-800">Create New Knowledge Base</h1>
        {actionData?.error && (
          <p className="text-sm text-red-600 bg-red-50 p-4 rounded-md border border-red-200" role="alert">
            {actionData.error}
          </p>
        )}
        <Form method="post" className="space-y-6 bg-white p-8 rounded-lg shadow">
          <div>
            <label htmlFor="kbName" className="block text-lg font-medium text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="kbName"
              id="kbName"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
              placeholder="e.g., Project Documentation, Team Policies"
            />
          </div>
          <div>
            <label htmlFor="kbDescription" className="block text-lg font-medium text-gray-700">
              Description (Optional)
            </label>
            <textarea
              id="kbDescription"
              name="kbDescription"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 block w-full px-4 py-3 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base resize-none"
              placeholder="Describe the purpose or content of this knowledge base..."
            />
            <p className="mt-2 text-sm text-gray-500">
              A brief description helps identify the knowledge base later.
            </p>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-md shadow text-base font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition duration-150 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <ArrowPathIcon className="animate-spin h-5 w-5 mr-2" />
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