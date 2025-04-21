import { ClientOnly } from './ClientOnly';
import ThemeToggle from './ThemeToggle';

/**
 * SafeThemeToggle component that only renders the ThemeToggle on the client
 * This prevents the "useTheme must be used within a ThemeProvider" error
 */
export default function SafeThemeToggle() {
  return (
    <ClientOnly fallback={<div className="p-2 rounded-full w-9 h-9"></div>}>
      {() => <ThemeToggle />}
    </ClientOnly>
  );
}
