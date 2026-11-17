import { isDemoSource } from "@/lib/constants";
import { Badge } from "./badge";

/**
 * Distinguishes demo/seed rows from records imported from an authorized source.
 * The `source` value is stored by the backend; this badge never invents data.
 */
export function SourceBadge({ source }: { source: string }) {
  if (isDemoSource(source)) {
    return (
      <Badge
        tone="warning"
        title="This row is tagged as demo/seed data by its source value."
      >
        Demo data
      </Badge>
    );
  }

  return (
    <Badge tone="neutral" title={`Record source: ${source}`}>
      {source || "Unknown"}
    </Badge>
  );
}
