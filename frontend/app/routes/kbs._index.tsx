// frontend/app/routes/kbs._index.tsx

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, NavLink } from "@remix-run/react"; // Added NavLink for potential sidebar highlighting
import { listKnowledgeBases, type KnowledgeBaseInfo } from "~/lib/apiClient";
import { PlusIcon, CircleStackIcon, HomeIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import SafeThemeToggle from "~/components/SafeThemeToggle";

// Loader: Fetches the list of knowledge bases
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    console.log("kbs._index Loader: Fetching knowledge bases...");
    const knowledgeBases = await listKnowledgeBases();
    console.log(`kbs._index Loader: Found ${knowledgeBases.length} KBs.`);
    // Return data successfully
    return json({ knowledgeBases: knowledgeBases ?? [], error: null });
  } catch (error: unknown) {
    console.error("kbs._index Loader: Failed to load knowledge bases:", error);
    let errorMessage = "An unexpected error occurred while loading knowledge bases.";
    let status = 500;

    // Handle Remix Response errors specifically
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

    // Return error state
    return json({ knowledgeBases: [], error: errorMessage }, { status });
  }
}

// Component: Renders the list of knowledge bases
export default function KnowledgeBaseList() {
    const { knowledgeBases, error } = useLoaderData<typeof loader>();

    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto min-h-screen bg-white dark:bg-dark-bg text-gray-900 dark:text-dark-text">
        {/* Navigation to home */}
        <div className="mb-6 pb-4 border-b border-gray-200 dark:border-dark-border">
          <div className="flex justify-between items-center mb-2">
            <nav>
              <Link to="/" className="inline-flex items-center text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
                <HomeIcon className="h-4 w-4 mr-1"/>  Home
              </Link>
            </nav>
            <SafeThemeToggle />
          </div>
          <h1 className="text-xl md:text-2xl font-semibold text-gray-800 dark:text-dark-text flex items-center">
            <CircleStackIcon className="h-6 w-6 mr-2 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            Knowledge Bases
          </h1>
        </div>

        <div className="bg-white dark:bg-dark-card p-4 rounded-lg shadow dark:shadow-gray-900 border border-gray-200 dark:border-dark-border mb-6">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-600 dark:text-dark-muted">Create and manage your knowledge bases</p>
            <Link
              to="/kbs/new"
              className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-blue-500 transition ease-in-out duration-150"
            >
              <PlusIcon className="-ml-1 mr-1.5 h-5 w-5" aria-hidden="true" />
              New KB
            </Link>
          </div>

          {/* Display Loader Error if exists */}
          {error && (
            <div className="mt-4 rounded-md bg-red-50 dark:bg-red-900/30 p-4 border border-red-200 dark:border-red-800">
              <div className="flex">
                <div className="flex-shrink-0">
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-400 dark:text-red-500" aria-hidden="true" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-300">Loading Error</h3>
                  <div className="mt-1 text-sm text-red-700 dark:text-red-400">
                    <p>{error}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Empty State */}
        {knowledgeBases.length === 0 && !error && (
          <div className="text-center py-10 px-4 bg-white dark:bg-dark-card border border-dashed border-gray-300 dark:border-dark-border rounded-lg shadow-sm dark:shadow-gray-900">
            <CircleStackIcon className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500" />
            <h3 className="mt-2 text-lg font-medium text-gray-900 dark:text-dark-text">No Knowledge Bases Found</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              You haven't created any knowledge bases yet.
            </p>
            <div className="mt-6">
              <Link
                to="/kbs/new"
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-dark-bg focus:ring-blue-500"
              >
                <PlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                Create Your First KB
              </Link>
            </div>
          </div>
        )}

        {/* KB List */}
        {knowledgeBases.length > 0 && (
          <div className="bg-white dark:bg-dark-card shadow dark:shadow-gray-900 border border-gray-200 dark:border-dark-border overflow-hidden sm:rounded-md">
            <ul role="list" className="divide-y divide-gray-200 dark:divide-dark-border">
              {knowledgeBases.filter((kb): kb is KnowledgeBaseInfo => kb !== null).map((kb) => (
                <li key={kb.id}>
                  <Link to={`/kbs/${kb.id}`} className="block hover:bg-gray-50 dark:hover:bg-gray-800 transition duration-150 ease-in-out">
                    <div className="px-4 py-4 sm:px-6">
                      <div className="flex items-center justify-between">
                        <p className="text-md font-medium text-blue-600 dark:text-blue-400 truncate">{kb.name}</p>
                        <div className="ml-2 flex-shrink-0 flex">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300">
                            ID: {kb.id.substring(0, 8)}...
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 sm:flex sm:justify-between">
                        <div className="sm:flex">
                          <p className="flex items-center text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                            {kb.description || <span className="italic text-gray-400 dark:text-gray-500">No description</span>}
                          </p>
                        </div>
                        <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400 sm:mt-0">
                          <p>Created: {new Date(kb.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

// Optional: Add a handle for specific errors if needed
// export function ErrorBoundary() { ... }