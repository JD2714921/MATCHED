import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser } from "@/lib/auth";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTION_TONES: Record<string, "positive" | "negative" | "accent" | "neutral"> = {
  PROMOTION_PUBLISHED: "positive",
  PROMOTION_REJECTED: "negative",
  PROMOTION_UNPUBLISHED: "negative",
  SOURCE_COLLECTION_APPROVED: "positive",
  SOURCE_COLLECTION_REFUSED: "negative",
  BET_PLAN_COMPLETED: "positive",
};

export default async function AuditPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?redirectTo=%2Fadmin%2Faudit");
  if (user.role !== "ADMIN") throw new AuthError("FORBIDDEN", "This area is for administrators.");

  const entries = await prisma.auditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        lede="Who did what, and when. Every publication, rejection and collection approval is here."
        right={
          <Link href="/admin" className="text-[12px] text-accent underline underline-offset-2">
            Back to queue
          </Link>
        }
      />

      <Panel>
        {entries.length === 0 ? (
          <EmptyState title="Nothing recorded yet" body="Actions appear here as they happen." />
        ) : (
          <table className="data-table" data-testid="audit-table">
            <thead>
              <tr>
                <th className="pl-5">When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Entity</th>
                <th className="pr-5">Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap pl-5 text-[12px] text-ink-faint">
                    {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="text-[12px] text-ink-muted">
                    {entry.actor?.email ?? <span className="text-ink-faint">system</span>}
                  </td>
                  <td>
                    <Badge tone={ACTION_TONES[entry.action] ?? "neutral"}>
                      {entry.action.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  </td>
                  <td className="text-[12px] text-ink-faint">{entry.entityType}</td>
                  <td className="pr-5 text-[11px] text-ink-faint">
                    {entry.detail ? JSON.stringify(entry.detail) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </>
  );
}
