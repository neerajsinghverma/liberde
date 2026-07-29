import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Liberde",
  description: "The terms for using Liberde.",
};

const UPDATED = "July 25, 2026";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back to Liberde
      </Link>
      <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-ink-muted">Last updated: {UPDATED}</p>

      <div className="prose-legal mt-8 space-y-6 text-[15px] leading-relaxed text-ink">
        <section>
          <h2 className="font-display text-xl font-semibold">The short version</h2>
          <p>
            Liberde is free, open-source software provided as-is. Be reasonable, don&apos;t
            abuse it, and understand that the hosted service is run on a best-effort basis
            with no guarantees. If those terms don&apos;t work for you, you&apos;re welcome
            to run your own copy of the source instead.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Using the service</h2>
          <p>
            You may use Liberde for lawful purposes. You are responsible for the content
            you submit and for complying with the terms of any model provider whose keys
            you connect. Don&apos;t use the service to break the law, infringe others&apos;
            rights, distribute malware, or attempt to disrupt or gain unauthorized access
            to the service or its other users.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Your account</h2>
          <p>
            You&apos;re responsible for keeping your login secure. AI output can be
            inaccurate — don&apos;t rely on it as professional, legal, medical, or
            financial advice, and verify anything important.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Open source</h2>
          <p>
            Liberde&apos;s source code is released under its open-source license, and your
            rights to the code are governed by that license. These Terms cover use of the
            hosted service at liberde.ai, not the code itself.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">No warranty; limitation of liability</h2>
          <p>
            The hosted service is provided <strong>&ldquo;as is&rdquo;</strong> and{" "}
            <strong>&ldquo;as available,&rdquo;</strong> without warranties of any kind. To
            the maximum extent permitted by law, the operators of Liberde are not liable
            for any indirect, incidental, or consequential damages, or for any loss of
            data, arising from your use of the service. The service may change or be
            discontinued at any time.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Changes &amp; contact</h2>
          <p>
            We may update these Terms from time to time; continued use means you accept the
            current version. Questions? Email{" "}
            <a className="text-accent hover:underline" href="mailto:hello@liberde.ai">
              hello@liberde.ai
            </a>
            .
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm text-ink-muted">
        See also our{" "}
        <Link href="/privacy" className="text-accent hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
