import { BarChart3 } from "lucide-react";
import { formatNumber } from "@/lib/format";

export interface BarListItem {
  label: string;
  value: number;
  meta?: string;
}

export function BarList({
  items,
  maxItems = 8,
  emptyMessage = "No data yet.",
  valueLabel = "records",
}: {
  items: BarListItem[];
  maxItems?: number;
  emptyMessage?: string;
  valueLabel?: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
        <BarChart3 className="h-6 w-6 text-slate-300" aria-hidden="true" />
        <p className="mt-2 text-sm text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  const visible = items.slice(0, maxItems);
  const hidden = items.length - visible.length;
  const maxValue = Math.max(...visible.map((item) => item.value), 1);

  return (
    <div>
      <ul className="space-y-4" aria-label={`Distribution of ${valueLabel}`}>
        {visible.map((item) => (
          <li key={`${item.label}-${item.meta ?? ""}`}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm font-medium text-slate-700">
                {item.label}
                {item.meta ? (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">
                    {item.meta}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-sm tabular-nums text-slate-500">
                {formatNumber(item.value)}
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{
                  width: `${Math.max(4, (item.value / maxValue) * 100)}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {hidden > 0 ? (
        <p className="mt-4 text-xs text-slate-400">
          Showing top {visible.length} of {items.length}.
        </p>
      ) : null}
    </div>
  );
}
