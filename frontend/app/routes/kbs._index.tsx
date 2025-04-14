// frontend/app/routes/kbs._index.tsx

import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, Link, NavLink } from "@remix-run/react"; // Added NavLink for potential sidebar highlighting
import { listKnowledgeBases, type KnowledgeBaseInfo } from "~/lib/apiClient";
import { PlusIcon, CircleStackIcon } from "@heroicons/react/24/outline";

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
      <div className="container mx-auto p-6">
        {/* Navigation to home */}
        <nav className="mb-6">
          <Link to="/" className="inline-flex items-center text-blue-600 hover:underline">
            &#8592; Home
          </Link>
        </nav>
  
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-center mb-6 border-b border-gray-200 pb-4">
            <h1 className="text-xl md:text-2xl font-semibold text-gray-800 flex items-center">
              <CircleStackIcon className="h-6 w-6 mr-2 text-blue-600" />
              Knowledge Bases
            </h1>
            <Link
              to="/kbs/new"
              className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition ease-in-out duration-150"
            >
              <PlusIcon className="-ml-1 mr-1.5 h-5 w-5" aria-hidden="true" />
              New KB
            </Link>
          </div>
  
          {/* Display Loader Error if exists */}
          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-4">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Loading Error</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{error}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
  
          {/* Empty State */}
          {knowledgeBases.length === 0 && !error && (
            <div className="text-center py-12 px-4 bg-white border border-dashed border-gray-300 rounded-lg shadow-sm">
              <CircleStackIcon className="mx-auto h-10 w-10 text-gray-400" />
              <h3 className="mt-2 text-lg font-medium text-gray-900">No Knowledge Bases Found</h3>
              <p className="mt-1 text-sm text-gray-500">
                You haven't created any knowledge bases yet.
              </p>
              <div className="mt-6">
                <Link
                  to="/kbs/new"
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <PlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
                  Create Your First KB
                </Link>
              </div>
            </div>
          )}
  
          {/* KB List */}
          {knowledgeBases.length > 0 && (
            <div className="shadow overflow-hidden sm:rounded-md">
              <ul role="list" className="divide-y divide-gray-200">
                {knowledgeBases.map((kb) => (
                  <li key={kb.id}>
                    <Link to={`/kbs/${kb.id}`} className="block hover:bg-gray-50 transition duration-150 ease-in-out">
                      <div className="px-4 py-4 sm:px-6">
                        <div className="flex items-center justify-between">
                          <p className="text-md font-medium text-blue-600 truncate">{kb.name}</p>
                          <div className="ml-2 flex-shrink-0 flex">
                            <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                              ID: {kb.id.substring(0, 8)}...
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 sm:flex sm:justify-between">
                          <div className="sm:flex">
                            <p className="flex items-center text-sm text-gray-500 line-clamp-2">
                              {kb.description || <span className="italic text-gray-400">No description</span>}
                            </p>
                          </div>
                          <div className="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
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
      </div>
    );
  }

// Optional: Add a handle for specific errors if needed
// export function ErrorBoundary() { ... }