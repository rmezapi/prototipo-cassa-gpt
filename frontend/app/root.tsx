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
} from "@remix-run/react";

// Optional: Import a global CSS file if you create one
// import styles from "./tailwind.css"; // Example if using Tailwind
// import globalStyles from "./styles/global.css"; // Example for plain CSS

// Add links to any global stylesheets here
export const links: LinksFunction = () => [
  ...(cssBundleHref ? [{ rel: "stylesheet", href: cssBundleHref }] : []),
  // { rel: "stylesheet", href: styles }, // Example
  // { rel: "stylesheet", href: globalStyles }, // Example
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {/* Main content area where routes will render */}
        <Outlet />

        {/* Remix utilities */}
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}