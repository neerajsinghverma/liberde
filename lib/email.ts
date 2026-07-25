// Transactional email via Resend. Inert (no-op) unless RESEND_API_KEY is set,
// so self-host installs without email just skip it.

const FROM = () => `Liberde <noreply@${process.env.RESEND_EMAIL_DOMAIN || "liberde.ai"}>`;

async function send(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // email disabled — no-op
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM(), to, subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/** Branded wrapper — light, on-brand (terracotta accent), works in email clients. */
function shell(title: string, body: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#faf9f5;font-family:-apple-system,Segoe UI,system-ui,sans-serif;color:#1f1e1b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid #ece7db;border-radius:16px;overflow:hidden">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #f0ebe0">
          <span style="font-family:Georgia,serif;font-weight:700;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:#d97757">Liberde</span>
        </td></tr>
        <tr><td style="padding:26px 28px 8px">
          <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:20px;line-height:1.3;color:#1f1e1b">${title}</h1>
          <div style="font-size:14px;line-height:1.6;color:#44413b">${body}</div>
        </td></tr>
        ${cta ? `<tr><td style="padding:8px 28px 26px"><a href="${cta.url}" style="display:inline-block;background:#d97757;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px">${cta.label}</a></td></tr>` : ""}
        <tr><td style="padding:16px 28px;border-top:1px solid #f0ebe0;font-size:11px;color:#8a857c">You received this because someone used this address on liberde.ai. If it wasn't you, you can ignore this email.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendPasswordReset(to: string, link: string): Promise<void> {
  await send(
    to,
    "Reset your Liberde password",
    shell(
      "Reset your password",
      `<p style="margin:0 0 10px">Click the button below to choose a new password. This link expires in <strong>1 hour</strong>.</p>
       <p style="margin:0;color:#8a857c;font-size:12px">If the button doesn't work, copy this link:<br><span style="word-break:break-all;color:#b05730">${link}</span></p>`,
      { label: "Reset password", url: link }
    )
  );
}

export async function sendVerification(to: string, link: string): Promise<void> {
  await send(
    to,
    "Verify your Liberde email",
    shell(
      "Verify your email",
      `<p style="margin:0 0 10px">Confirm this is your address to finish setting up your Liberde account. This link expires in <strong>24 hours</strong>.</p>
       <p style="margin:0;color:#8a857c;font-size:12px">If the button doesn't work, copy this link:<br><span style="word-break:break-all;color:#b05730">${link}</span></p>`,
      { label: "Verify email", url: link }
    )
  );
}
