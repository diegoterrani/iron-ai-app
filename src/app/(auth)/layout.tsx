export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="auth-shell">
      {/* O logo leva à home do site institucional (fora do app). */}
      <a href="https://iron-ai.io" className="auth-brand" aria-label="IRON AI, página inicial do site">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-lockup.svg" alt="" width={147} height={44} />
      </a>
      <section className="auth-card">{children}</section>
    </main>
  );
}
