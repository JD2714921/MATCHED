import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AuthError, getCurrentUser } from "@/lib/auth";
import { validateReading } from "@/lib/promotions/pipeline";
import { REVIEW_READY_CONFIDENCE, type PromotionReading } from "@/lib/ai/types";
import { getExchangeProvider } from "@/lib/exchange";
import { getAiProvider } from "@/lib/ai";
import { Badge, EmptyState, Note, PageHeader, Panel } from "@/components/ui";
import { ReadingDiff } from "@/components/reading-diff";
import { publish, reinterpret, reject, unpublish } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login?redirectTo=%2Fadmin");
  if (user.role !== "ADMIN") throw new AuthError("FORBIDDEN", "This area is for administrators.");

  const queue = await prisma.promotion.findMany({
    where: { status: { in: ["NEEDS_VERIFICATION", "DRAFT"] } },
    include: {
      operator: true,
      rawCapture: true,
      interpretations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  const publishedCount = await prisma.promotion.count({ where: { status: "PUBLISHED" } });
  const rejectedCount = await prisma.promotion.count({ where: { status: "REJECTED" } });

  const [exchangeHealth, aiHealth] = await Promise.all([
    getExchangeProvider().healthCheck(),
    getAiProvider().healthCheck(),
  ]);

  return (
    <>
      <PageHeader
        title="Administration"
        lede="Nothing reaches a customer without a person putting it there."
        right={
          <div className="flex gap-3 text-[12px]">
            <Link href="/admin/sources" className="text-accent underline underline-offset-2">
              Sources
            </Link>
            <Link href="/admin/audit" className="text-accent underline underline-offset-2">
              Audit log
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <HealthCard
          title="Exchange"
          live={exchangeHealth.live}
          ok={exchangeHealth.ok}
          message={exchangeHealth.message}
          detail={`${exchangeHealth.provider} · ${exchangeHealth.dataDelayed ? "delayed data" : "not delayed"} · ${exchangeHealth.tradedVolumeAvailable ? "volume available" : "no traded volume"}`}
        />
        <HealthCard
          title="Interpretation"
          live={aiHealth.live}
          ok={aiHealth.ok}
          message={aiHealth.message}
          detail={`${aiHealth.provider}${aiHealth.model ? ` · ${aiHealth.model}` : ""}`}
        />
        <div className="rounded-[6px] border border-line bg-surface p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
            Promotions
          </div>
          <div className="figure mt-1.5 text-[24px] font-semibold leading-none text-ink">
            {queue.length}
          </div>
          <div className="mt-1.5 text-[11px] text-ink-faint">
            awaiting verification · {publishedCount} published · {rejectedCount} rejected
          </div>
        </div>
      </div>

      <div className="mb-3 text-[13px] font-semibold text-ink">Verification queue</div>

      {queue.length === 0 ? (
        <Panel>
          <EmptyState
            title="The queue is empty"
            body="Newly collected promotions arrive here after interpretation, and stay until a person decides."
          />
        </Panel>
      ) : (
        <div className="space-y-4" data-testid="verification-queue">
          {queue.map((promotion) => {
            const interpretation = promotion.interpretations[0];
            const reading = (interpretation?.fields ?? null) as PromotionReading | null;
            const confidence = interpretation ? Number(interpretation.confidence) : 0;
            const issues = reading ? validateReading(reading) : [];
            const blocking = issues.filter((issue) => issue.severity === "BLOCKING");
            const reviewReady = confidence >= REVIEW_READY_CONFIDENCE && blocking.length === 0;

            return (
              <Panel
                key={promotion.id}
                title={promotion.title}
                subtitle={`${promotion.operator.name}${promotion.operator.isFictional ? " · invented operator" : ""}`}
                right={
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={reviewReady ? "positive" : "caution"}>
                      {Math.round(confidence * 100)}% read
                    </Badge>
                    {interpretation?.numericGuardFired && (
                      <Badge tone="negative" title={interpretation.numericGuardDetail ?? undefined}>
                        guard fired
                      </Badge>
                    )}
                  </div>
                }
              >
                <div className="space-y-4 p-5">
                  {blocking.length > 0 && (
                    <div className="space-y-2">
                      {blocking.map((issue) => (
                        <Note key={issue.field} tone="caution">
                          <span className="font-medium">{issue.field}:</span> {issue.message}
                        </Note>
                      ))}
                    </div>
                  )}

                  {interpretation && (
                    <div className="text-[12px] leading-relaxed text-ink-muted">
                      <span className="font-medium text-ink">
                        {interpretation.providerName}
                        {interpretation.providerModel ? ` (${interpretation.providerModel})` : ""}:
                      </span>{" "}
                      {interpretation.reasoning}
                    </div>
                  )}

                  {promotion.rawCapture && reading ? (
                    <ReadingDiff
                      rawTitle={promotion.rawCapture.rawTitle}
                      rawText={promotion.rawCapture.rawText}
                      reading={reading}
                    />
                  ) : (
                    <Note>No raw capture is attached to this promotion.</Note>
                  )}

                  <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                    <form action={publish}>
                      <input type="hidden" name="promotionId" value={promotion.id} />
                      <button
                        type="submit"
                        data-testid="publish-promotion"
                        className="rounded-[4px] bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent-ink"
                      >
                        Verify and publish
                      </button>
                    </form>

                    {promotion.rawCaptureId && (
                      <form action={reinterpret}>
                        <input type="hidden" name="captureId" value={promotion.rawCaptureId} />
                        <button
                          type="submit"
                          className="rounded-[4px] border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-surface-sunken"
                        >
                          Read again
                        </button>
                      </form>
                    )}

                    <form action={reject} className="flex items-center gap-2">
                      <input type="hidden" name="promotionId" value={promotion.id} />
                      <input
                        name="reason"
                        placeholder="Reason for rejecting"
                        className="w-56 rounded-[4px] border border-line-strong px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
                      />
                      <button
                        type="submit"
                        className="rounded-[4px] border border-line-strong px-3 py-1.5 text-[12px] text-negative hover:bg-negative-soft"
                      >
                        Reject
                      </button>
                    </form>
                  </div>

                  <Note>
                    Publishing records you as the person who verified this reading. Interpretation
                    alone never publishes anything, however confident it is.
                  </Note>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <PublishedList />
    </>
  );
}

async function PublishedList() {
  const published = await prisma.promotion.findMany({
    where: { status: "PUBLISHED" },
    include: { operator: true, publishedById: false },
    orderBy: { publishedAt: "desc" },
  });

  if (published.length === 0) return null;

  return (
    <>
      <div className="mt-6 mb-3 text-[13px] font-semibold text-ink">Published</div>
      <Panel>
        <table className="data-table">
          <thead>
            <tr>
              <th className="pl-5">Offer</th>
              <th>Operator</th>
              <th>Published</th>
              <th className="pr-5"></th>
            </tr>
          </thead>
          <tbody>
            {published.map((promotion) => (
              <tr key={promotion.id}>
                <td className="pl-5 text-[13px] text-ink">{promotion.title}</td>
                <td className="text-[12px] text-ink-muted">{promotion.operator.name}</td>
                <td className="text-[12px] text-ink-faint">
                  {promotion.publishedAt?.toISOString().slice(0, 10) ?? "—"}
                </td>
                <td className="pr-5 text-right">
                  <form action={unpublish}>
                    <input type="hidden" name="promotionId" value={promotion.id} />
                    <button
                      type="submit"
                      className="rounded-[4px] border border-line-strong px-2.5 py-1 text-[12px] text-ink-muted hover:bg-surface-sunken"
                    >
                      Withdraw
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

function HealthCard({
  title,
  live,
  ok,
  message,
  detail,
}: {
  title: string;
  live: boolean;
  ok: boolean;
  message: string;
  detail: string;
}) {
  return (
    <div className="rounded-[6px] border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
          {title}
        </div>
        <Badge tone={!ok ? "negative" : live ? "positive" : "caution"}>
          {!ok ? "failing" : live ? "live" : "not live"}
        </Badge>
      </div>
      <div className="mt-2 text-[12px] leading-relaxed text-ink-muted">{message}</div>
      <div className="mt-2 text-[11px] text-ink-faint">{detail}</div>
    </div>
  );
}
