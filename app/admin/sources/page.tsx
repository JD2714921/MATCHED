import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser } from "@/lib/auth";
import { canCollectAutomatically, requiresCollectionApproval } from "@/lib/promotions/pipeline";
import { Badge, Note, PageHeader, Panel } from "@/components/ui";
import { setSourceApproval } from "../actions";

export const dynamic = "force-dynamic";

const METHOD_LABELS: Record<string, string> = {
  MANUAL_ENTRY: "Entered by hand",
  OPERATOR_AFFILIATE_FEED: "Operator's own feed",
  PUBLIC_PAGE_FETCH: "Fetched from a public page",
  PARTNER_API: "Partner API",
};

export default async function SourcesPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?redirectTo=%2Fadmin%2Fsources");
  if (user.role !== "ADMIN") throw new AuthError("FORBIDDEN", "This area is for administrators.");

  const sources = await prisma.promotionSource.findMany({
    include: { operator: true, _count: { select: { captures: true } } },
    orderBy: [{ operator: { name: "asc" } }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader
        title="Sources"
        lede="Where promotions come from, and whether we may collect from them without a person present."
        right={
          <Link href="/admin" className="text-[12px] text-accent underline underline-offset-2">
            Back to queue
          </Link>
        }
      />

      <div className="mb-4">
        <Note tone="caution">
          Automated collection is off by default and stays off until both a robots.txt check and a
          terms-of-use review are recorded against the source. Entering an offer by hand, or
          receiving one through a feed the operator sends us, needs no approval — neither fetches
          anything from their site.
        </Note>
      </div>

      <div className="space-y-4">
        {sources.map((source) => {
          const permission = canCollectAutomatically(source);
          const needsApproval = requiresCollectionApproval(source.collectionMethod);

          return (
            <Panel
              key={source.id}
              title={source.name}
              subtitle={`${source.operator.name} · ${METHOD_LABELS[source.collectionMethod] ?? source.collectionMethod} · ${source._count.captures} capture${source._count.captures === 1 ? "" : "s"}`}
              right={
                <Badge tone={permission.allowed ? "positive" : "caution"}>
                  {permission.allowed ? "may collect" : "collection off"}
                </Badge>
              }
            >
              <div className="space-y-4 p-5">
                <div className="text-[12px] leading-relaxed text-ink-muted">
                  {permission.reason}
                </div>

                <dl className="grid gap-x-6 gap-y-2 text-[12px] sm:grid-cols-2">
                  <Field label="URL" value={source.url ?? "—"} />
                  <Field
                    label="Automated collection approved"
                    value={source.automatedCollectionApproved ? "yes" : "no"}
                  />
                  <Field
                    label="robots.txt checked"
                    value={
                      source.robotsTxtCheckedAt
                        ? `${source.robotsTxtCheckedAt.toISOString().slice(0, 10)} — ${source.robotsTxtAllows ? "allows" : "disallows"}`
                        : "never"
                    }
                  />
                  <Field
                    label="Terms reviewed"
                    value={source.termsReviewedAt?.toISOString().slice(0, 10) ?? "never"}
                  />
                  <Field
                    label="Last collected"
                    value={source.lastCollectedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "never"}
                  />
                  <Field label="Note" value={source.approvalNote ?? "—"} />
                </dl>

                {needsApproval && (
                  <form
                    action={setSourceApproval}
                    className="space-y-3 border-t border-line pt-4"
                  >
                    <input type="hidden" name="sourceId" value={source.id} />
                    <fieldset>
                      <legend className="text-[12px] font-medium text-ink">
                        Record a robots.txt check
                      </legend>
                      <div className="mt-2 flex gap-4">
                        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                          <input type="radio" name="robotsTxtAllows" value="yes" />
                          robots.txt allows this path
                        </label>
                        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                          <input type="radio" name="robotsTxtAllows" value="no" defaultChecked />
                          it does not, or I am unsure
                        </label>
                      </div>
                    </fieldset>
                    <input
                      name="approvalNote"
                      placeholder="What you checked, and when"
                      className="w-full rounded-[4px] border border-line-strong px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
                    />
                    <button
                      type="submit"
                      className="rounded-[4px] bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-ink"
                    >
                      Record both checks
                    </button>
                    <p className="text-[11px] leading-relaxed text-ink-faint">
                      Recording this stores you as the person who checked. Choosing &ldquo;does not
                      allow&rdquo; leaves collection switched off.
                    </p>
                  </form>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="break-words text-[12px] text-ink-muted">{value}</dd>
    </div>
  );
}
