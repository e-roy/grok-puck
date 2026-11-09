// Light and dark: follows the system unless the header's switch picks one. The choice is a per-browser
// convenience kept in localStorage; the page works the same without it.
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'desk-bridge-theme';

function saved(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

const dark = () => window.matchMedia('(prefers-color-scheme: dark)');

const ThemeContext = createContext<{ choice: ThemeChoice; resolved: 'light' | 'dark'; choose: (c: ThemeChoice) => void }>({
  choice: 'system',
  resolved: 'light',
  choose: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(saved);
  const [systemDark, setSystemDark] = useState(() => dark().matches);
  useEffect(() => {
    const query = dark();
    const listener = () => setSystemDark(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  const choose = (c: ThemeChoice) => {
    setChoice(c);
    try {
      if (c === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {
      // not kept; fine
    }
  };
  return <ThemeContext.Provider value={{ choice, resolved, choose }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
