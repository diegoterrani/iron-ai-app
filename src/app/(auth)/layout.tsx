import Link from "next/link";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="auth-shell">
      <Link href="/" className="auth-brand" aria-label="IRON AI, início">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-lockup.svg" alt="" width={147} height={44} />
      </Link>
      <section className="auth-card">{children}</section>
    </main>
  );
}
