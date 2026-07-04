/**
 * Toasts — התראות צפות (הצלחה/שגיאה) בפינה השמאלית-תחתונה, RTL.
 * נסגרות אוטומטית אחרי ~3 שניות. aria-live כדי לא לגנוב פוקוס.
 */
import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';

interface Toast {
  id: number;
  text: string;
  kind: 'success' | 'error' | 'info';
}

const Ctx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toast-area" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
