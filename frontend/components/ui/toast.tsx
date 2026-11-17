"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastTone = "success" | "error" | "info";

interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
}

interface ToastItem extends ToastInput {
  id: number;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-white text-slate-900",
  error: "border-red-200 bg-white text-slate-900",
  info: "border-sky-200 bg-white text-slate-900",
};

const TONE_ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const TONE_ICON_STYLES: Record<ToastTone, string> = {
  success: "text-emerald-600",
  error: "text-red-600",
  info: "text-sky-600",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const timer = timers.current.get(id);

    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current;
      nextId.current += 1;

      setToasts((current) => [
        ...current,
        { ...input, id, tone: input.tone ?? "info" },
      ]);

      timers.current.set(
        id,
        setTimeout(() => remove(id), 5000)
      );
    },
    [remove]
  );

  useEffect(() => {
    const activeTimers = timers.current;

    return () => {
      for (const timer of activeTimers.values()) {
        clearTimeout(timer);
      }
      activeTimers.clear();
    };
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:right-0 sm:w-full sm:max-w-sm"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICONS[toast.tone];

          return (
            <div
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
              className={cn(
                "animate-toast-in pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg",
                TONE_STYLES[toast.tone]
              )}
            >
              <Icon
                className={cn("mt-0.5 h-5 w-5 shrink-0", TONE_ICON_STYLES[toast.tone])}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {toast.description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => remove(toast.id)}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider.");
  }

  return context;
}
