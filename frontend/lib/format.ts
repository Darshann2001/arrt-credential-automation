const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
});

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return numberFormatter.format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return dateFormatter.format(date);
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 45) {
    return "just now";
  }

  if (seconds < 90) {
    return "1 min ago";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} hr ago`;
  }

  const days = Math.round(hours / 24);

  if (days < 30) {
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  return formatDate(value);
}

/**
 * Human-readable duration between two timestamps. Returns "—" until both are
 * known, and "In progress" when only the start exists.
 */
export function formatDuration(
  start: string | null | undefined,
  end: string | null | undefined
): string {
  if (!start) {
    return "—";
  }

  const startedAt = new Date(start).getTime();

  if (Number.isNaN(startedAt)) {
    return "—";
  }

  if (!end) {
    return "In progress";
  }

  const completedAt = new Date(end).getTime();

  if (Number.isNaN(completedAt) || completedAt < startedAt) {
    return "—";
  }

  const totalSeconds = Math.round((completedAt - startedAt) / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}
