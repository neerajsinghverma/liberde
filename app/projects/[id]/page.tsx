import AppShell from "@/components/AppShell";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AppShell initialView={{ kind: "project", projectId: id }} />;
}
