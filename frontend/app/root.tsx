// frontend/app/root.tsx
import { cssBundleHref } from "@remix-run/css-bundle";
import type { LinksFunction } from "@remix-run/node"; // Use @remix-run/node for server types
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
// --- Import the Tailwind CSS file ---
import "./tailwind.css"; // Import the CSS file
import { ThemeProvider } from "./context/ThemeContext";
import { ClientOnly } from "./components/ClientOnly";

// Add links to any global stylesheets here
export const links: LinksFunction = () => [
  ...(cssBundleHref ? [{ rel: "stylesheet", href: cssBundleHref }] : [])
];

// Script to prevent flash of wrong theme
const themeInitScript = `
  (function() {
    let theme = localStorage.getItem('theme');
    if (!theme) {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      localStorage.setItem('theme', theme);
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
  })();
`;

// ClientOnly component to prevent hydration issues with theme
function ClientThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ClientOnly fallback={children}>
      {() => <ThemeProvider>{children}</ThemeProvider>}
    </ClientOnly>
  );
}

export default function App() {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* Inline script to set theme before any rendering happens */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="h-full transition-colors duration-200 bg-white dark:bg-dark-bg text-gray-900 dark:text-dark-text">
        <ClientThemeProvider>
          {/* Main content area where routes will render */}
          <Outlet />
        </ClientThemeProvider>

        {/* Remix utilities */}
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}