import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Script to be inserted into the document head to prevent flash of incorrect theme
const themeScript = `
(function() {
  // Immediately get the theme preference on page load before any rendering
  let theme = localStorage.getItem('theme');

  // If no theme preference is stored, check system preference
  if (!theme) {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    localStorage.setItem('theme', theme);
  }

  // Apply the theme class immediately to prevent flash
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
})();
`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize with a default, but this will be updated in useEffect
  const [theme, setTheme] = useState<Theme>('light');
  const [isInitialized, setIsInitialized] = useState(false);

  // Insert the theme script on the client side
  useEffect(() => {
    // Create and insert the script element
    const scriptElement = document.createElement('script');
    scriptElement.textContent = themeScript;
    document.head.appendChild(scriptElement);

    // Clean up
    return () => {
      document.head.removeChild(scriptElement);
    };
  }, []);

  // Initialize theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null;

    // Check for saved theme preference or system preference
    if (savedTheme) {
      setTheme(savedTheme);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
      localStorage.setItem('theme', 'dark');
    }

    setIsInitialized(true);
  }, []);

  // Update document class when theme changes
  useEffect(() => {
    if (!isInitialized) return;

    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Save to localStorage
    localStorage.setItem('theme', theme);
  }, [theme, isInitialized]);

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const setThemeValue = (newTheme: Theme) => {
    setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: setThemeValue }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
