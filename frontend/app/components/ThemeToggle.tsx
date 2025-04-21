import { useTheme } from '~/context/ThemeContext';
import { SunIcon, MoonIcon } from '@heroicons/react/24/outline';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Only show the toggle after component has mounted to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle theme toggle
  const handleToggle = () => {
    toggleTheme();
  };

  // If not mounted yet, render an empty div with the same dimensions to prevent layout shift
  if (!mounted) {
    return <div className="p-2 rounded-full w-9 h-9"></div>;
  }

  return (
    <button
      onClick={handleToggle}
      className="p-2 rounded-full bg-gray-100 dark:bg-dark-card text-gray-700 dark:text-dark-text hover:bg-gray-200 dark:hover:bg-dark-border transition-colors"
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'light' ? (
        <MoonIcon className="h-5 w-5" />
      ) : (
        <SunIcon className="h-5 w-5" />
      )}
    </button>
  );
}
