import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "./card";

type Tone = "brand" | "success" | "danger" | "neutral";

const ICON_TONES: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-600",
  success: "bg-emerald-50 text-emerald-600",
  danger: "bg-red-50 text-red-600",
  neutral: "bg-slate-100 text-slate-600",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            ICON_TONES[tone]
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </Card>
  );
}
