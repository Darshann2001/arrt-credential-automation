import type { Metadata } from "next";
import { CreateJobForm } from "@/components/jobs/create-job-form";

export const metadata: Metadata = {
  title: "Create Collection Job",
};

export default function NewJobPage() {
  return <CreateJobForm />;
}
