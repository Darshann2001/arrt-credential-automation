"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="py-16">
      <ErrorState
        title="This page could not be rendered"
        message="An unexpected client error occurred. Try again; if the problem continues, check the browser console and the API logs."
        onRetry={reset}
      />
    </div>
  );
}
