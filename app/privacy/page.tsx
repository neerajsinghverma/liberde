import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Liberde",
  description: "How Liberde handles your data.",
};

const UPDATED = "July 25, 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← Back to Liberde
      </Link>
      <h1 className="mt-6 font-display text-4xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-ink-muted">Last updated: {UPDATED}</p>

      <div className="prose-legal mt-8 space-y-6 text-[15px] leading-relaxed text-ink">
        <section>
          <h2 className="font-display text-xl font-semibold">What Liberde is</h2>
          <p>
            Liberde is an open-source, self-hostable AI chat application. It lets you
            talk to large language models through your own model-provider account. The
            hosted version at <strong>liberde.ai</strong> is operated on a best-effort,
            personal basis; you are also free to run your own copy of the source code.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Information we store</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Account details</strong> — your email address and display name. If
              you sign in with Google, we receive your email, name, and basic profile
              from Google solely to create and identify your account. We never receive
              your Google password.
            </li>
            <li>
              <strong>Your content</strong> — the conversations, projects, files, and
              settings you create, stored so we can show them back to you.
            </li>
            <li>
              <strong>Credentials you add</strong> — model-provider API keys you enter are
              stored to make requests on your behalf and are scoped to your account.
            </li>
            <li>
              <strong>Basic usage records</strong> — token counts and timestamps used to
              show you your own usage.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">How your content is used</h2>
          <p>
            Your prompts and the model&apos;s responses are sent to the model provider you
            select (for example, via OpenRouter) so the model can answer you. Those
            providers process the data under their own terms. We do not sell your data,
            and we do not use your conversations to train models.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Third parties</h2>
          <p>
            The hosted service relies on a small number of providers to function —
            hosting and database, the model routing provider, an email provider for
            account emails, and Google for optional sign-in. Each receives only what it
            needs to perform its function.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Your choices</h2>
          <p>
            You can delete your conversations and account content at any time from within
            the app. To delete your account entirely or request a copy of your data,
            contact us at the address below. If you self-host, you control all of your
            data directly.
          </p>
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Contact</h2>
          <p>
            Questions about this policy? Email{" "}
            <a className="text-accent hover:underline" href="mailto:privacy@liberde.ai">
              privacy@liberde.ai
            </a>
            .
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm text-ink-muted">
        See also our{" "}
        <Link href="/terms" className="text-accent hover:underline">
          Terms of Service
        </Link>
        .
      </p>
    </main>
  );
}
