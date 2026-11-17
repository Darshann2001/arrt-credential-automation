import type { Metadata } from "next";
import { RecordsExplorer } from "@/components/records/records-explorer";

export const metadata: Metadata = {
  title: "Credential Records",
};

export default function DashboardPage() {
  return <RecordsExplorer />;
}
