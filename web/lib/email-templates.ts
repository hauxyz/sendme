export type EmailTemplate = {
  id: string;
  name: string;
  description: string;
  subject: string;
  html: string;
};

const footer = (background = "#f8f8f8") => `
  <div style="margin-top:32px;padding:24px 8px;border-top:1px solid #e8e8e8;text-align:center;background:${background};border-radius:0 0 12px 12px;">
    <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#8a8a93;font-family:Arial,Helvetica,sans-serif;">
      You're receiving this email because you subscribed to updates.
    </p>
    <p style="margin:0;font-size:12px;color:#8a8a93;font-family:Arial,Helvetica,sans-serif;">
      <a href="{{unsubscribe_url}}" style="color:#8a8a93;text-decoration:underline;">Unsubscribe</a>
    </p>
  </div>`;

export const campaignTemplates: EmailTemplate[] = [
  {
    id: "dispatch",
    name: "Dispatch",
    description: "A bold newsletter layout with a feature story.",
    subject: "The next chapter of {{first_name}}",
    html: `
<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #ececef;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
  <div style="padding:26px 32px;border-bottom:1px solid #ececef;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:19px;font-weight:700;letter-spacing:-0.5px;color:#111114;">Acme</td>
        <td align="right" style="font-size:12px;color:#8a8a93;">Issue 014 · October</td>
      </tr>
    </table>
  </div>
  <div style="padding:40px 32px 12px;">
    <p style="margin:0 0 14px;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;color:#7c3aed;font-weight:700;">Product update</p>
    <h1 style="margin:0 0 16px;font-size:34px;line-height:1.15;letter-spacing:-1.2px;color:#111114;">A faster way to ship your best work.</h1>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.65;color:#55555f;">Hi {{first_name}}, we rebuilt the core workflow from the ground up. It's cleaner, quicker, and designed around the way your team actually works.</p>
    <a href="https://example.com" style="display:inline-block;background:#111114;color:#ffffff;padding:13px 22px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">See what's new →</a>
  </div>
  <div style="padding:24px 32px 32px;">
    <div style="background:#f7f5ff;border:1px solid #e9e4ff;border-radius:10px;padding:22px;">
      <p style="margin:0 0 12px;font-size:13px;font-weight:700;letter-spacing:0.2px;color:#6d28d9;">WHAT CHANGED</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="width:50%;padding:6px 12px 6px 0;vertical-align:top;font-size:13px;line-height:1.6;color:#3f3f46;">✦ &nbsp;A redesigned command centre</td>
          <td style="width:50%;padding:6px 0;vertical-align:top;font-size:13px;line-height:1.6;color:#3f3f46;">✦ &nbsp;Lightning-fast search</td>
        </tr>
        <tr>
          <td style="padding:6px 12px 6px 0;vertical-align:top;font-size:13px;line-height:1.6;color:#3f3f46;">✦ &nbsp;Shared workspaces</td>
          <td style="padding:6px 0;vertical-align:top;font-size:13px;line-height:1.6;color:#3f3f46;">✦ &nbsp;New API endpoints</td>
        </tr>
      </table>
    </div>
  </div>
  ${footer()}
</div>`,
  },
  {
    id: "minimal",
    name: "Minimal note",
    description: "A personal, plain-text-style email for founder updates.",
    subject: "A quick note from our team",
    html: `
<div style="max-width:560px;margin:0 auto;padding:16px 8px;font-family:Arial,Helvetica,sans-serif;">
  <p style="margin:0 0 26px;font-size:15px;line-height:1.7;color:#27272a;">Hi {{first_name}},</p>
  <h1 style="margin:0 0 18px;font-size:26px;line-height:1.3;letter-spacing:-0.6px;color:#111114;">We just crossed 10,000 sends.</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#3f3f46;">When we started building this product, we wanted email to feel simple again. No vendor lock-in, no black boxes — just infrastructure you can understand and own.</p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#3f3f46;">This week, that idea reached ten thousand emails sent through our users' direct delivery and own SMTP relays. Thank you for trusting us with something as important as your outbox.</p>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.75;color:#3f3f46;">If you have feedback, just reply to this email. I read every one.</p>
  <p style="margin:0 0 2px;font-size:15px;color:#27272a;">— Alex</p>
  <p style="margin:0 0 32px;font-size:13px;color:#8a8a93;">Founder, Acme</p>
  <div style="padding-top:20px;border-top:1px solid #e8e8e8;font-size:12px;line-height:1.6;color:#8a8a93;">
    You receive this because you signed up for updates. <a href="{{unsubscribe_url}}" style="color:#8a8a93;">Unsubscribe</a>
  </div>
</div>`,
  },
  {
    id: "launch",
    name: "Launch",
    description: "A centered announcement with a strong call to action.",
    subject: "Introducing {{first_name}}, meet the new SendMe",
    html: `
<div style="max-width:600px;margin:0 auto;background:#0b0b0e;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
  <div style="padding:22px 32px;border-bottom:1px solid rgba(255,255,255,0.08);">
    <span style="font-size:16px;font-weight:700;letter-spacing:-0.4px;color:#ffffff;">Acme</span>
  </div>
  <div style="padding:56px 40px;text-align:center;background:radial-gradient(circle at 50% 0%, #312e81 0%, #0b0b0e 62%);">
    <p style="margin:0 0 18px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c4b5fd;font-weight:700;">Now available</p>
    <h1 style="margin:0 0 18px;font-size:38px;line-height:1.12;letter-spacing:-1.4px;color:#ffffff;">The outbox your team deserves.</h1>
    <p style="margin:0 auto 28px;max-width:410px;font-size:15px;line-height:1.7;color:#a1a1aa;">Hi {{first_name}} — meet the new SendMe. Bring your own SMTP, manage every domain, and send at any scale.</p>
    <a href="https://example.com" style="display:inline-block;background:#8b5cf6;color:#ffffff;padding:14px 26px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;">Explore the launch →</a>
  </div>
  <div style="padding:30px 40px 36px;background:#0f0f12;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:0 10px 0 0;vertical-align:top;width:33%;">
          <p style="margin:0 0 5px;font-size:12px;font-weight:700;color:#ffffff;">SMTP native</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">Connect any provider in minutes.</p>
        </td>
        <td style="padding:0 10px;vertical-align:top;width:33%;">
          <p style="margin:0 0 5px;font-size:12px;font-weight:700;color:#ffffff;">Multi-domain</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">Separate senders, one dashboard.</p>
        </td>
        <td style="padding:0 0 0 10px;vertical-align:top;width:33%;">
          <p style="margin:0 0 5px;font-size:12px;font-weight:700;color:#ffffff;">Self-hosted</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">Your data stays on your servers.</p>
        </td>
      </tr>
    </table>
    <div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;font-size:11px;color:#52525b;">
      You're receiving this because you signed up for updates. <a href="{{unsubscribe_url}}" style="color:#71717a;">Unsubscribe</a>
    </div>
  </div>
</div>`,
  },
];

export const transactionalTemplate = `
<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
  <p style="margin:0 0 24px;font-size:14px;font-weight:700;letter-spacing:-0.2px;color:#111114;">Acme</p>
  <h1 style="margin:0 0 14px;font-size:27px;line-height:1.25;letter-spacing:-0.8px;color:#111114;">Welcome to Acme</h1>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#3f3f46;">Hi there,</p>
  <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:#3f3f46;">Thanks for signing up. Your account is ready — here's the link to get started.</p>
  <a href="https://example.com/login" style="display:inline-block;background:#111114;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;">Open your dashboard</a>
  <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#8a8a93;">If you didn't create this account, you can safely ignore this email.</p>
</div>`;

export function personalize(html: string): string {
  return html
    .replaceAll("{{first_name}}", "Alex")
    .replaceAll("{{ first_name }}", "Alex")
    .replaceAll("{{last_name}}", "Nguyen")
    .replaceAll("{{ last_name }}", "Nguyen")
    .replaceAll("{{email}}", "alex@example.com")
    .replaceAll("{{ email }}", "alex@example.com")
    .replaceAll("{{unsubscribe_url}}", "#unsubscribe")
    .replaceAll("{{ unsubscribe_url }}", "#unsubscribe");
}
