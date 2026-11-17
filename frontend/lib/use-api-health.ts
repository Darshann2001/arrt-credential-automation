"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api";

export type ApiConnection = "checking" | "online" | "offline";

/**
 * Polls GET /api/health so the shell can show whether the Express backend is
 * reachable. The UI keeps working (with error states) when it is not.
 */
export function useApiHealth(pollMs = 30_000): ApiConnection {
  const [status, setStatus] = useState<ApiConnection>("checking");

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    async function check() {
      controller?.abort();
      controller = new AbortController();

      try {
        await getHealth(controller.signal);

        if (active) {
          setStatus("online");
        }
      } catch (error) {
        if (
          active &&
          !(
            typeof error === "object" &&
            error !== null &&
            (error as { name?: string }).name === "AbortError"
          )
        ) {
          setStatus("offline");
        }
      }
    }

    void check();
    const timer = setInterval(() => void check(), pollMs);

    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
    };
  }, [pollMs]);

  return status;
}
