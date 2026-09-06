import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, authenticate, createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function POST(request: Request) {
  const form = await request.formData();
  const parsed = schema.safeParse({
    email: String(form.get("email") ?? ""),
    password: String(form.get("password") ?? ""),
  });

  const redirectTo = String(form.get("redirectTo") ?? "/");

  if (!parsed.success) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(parsed.error.issues[0]!.message)}`, request.url),
      303,
    );
  }

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    await createSession(user.id, request.headers.get("user-agent") ?? undefined);
    await prisma.auditLog.create({
      data: { actorUserId: user.id, action: "SIGN_IN", entityType: "User", entityId: user.id },
    });
    return NextResponse.redirect(new URL(redirectTo, request.url), 303);
  } catch (cause) {
    const message =
      cause instanceof AuthError ? cause.message : "Could not sign you in. Try again.";
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, request.url),
      303,
    );
  }
}
