import { useState, useEffect, ReactNode } from 'react';

interface ClientOnlyProps {
  children: () => ReactNode;
  fallback?: ReactNode;
}

/**
 * ClientOnly component to prevent hydration issues with client-only code
 * This is useful for code that needs to access browser APIs like localStorage
 */
export function ClientOnly({ children, fallback = null }: ClientOnlyProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <>{fallback}</>;
  }

  return <>{children()}</>;
}
