import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <EmptyState
        icon={FileQuestion}
        title="Page not found"
        description="The page you requested does not exist or may have moved."
        action={
          <Link
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            Back to dashboard
          </Link>
        }
      />
    </div>
  );
}
