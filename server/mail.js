/** Transactional email via [Resend](https://resend.com). */

function emailShell({ title, bodyHtml }) {
  return `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 520px; margin: 0 auto;">
      <h1 style="font-size: 1.25rem; margin: 0 0 1rem;">${title}</h1>
      ${bodyHtml}
      <p style="margin: 1.5rem 0 0; font-size: 0.85rem; color: #666;">Poker Games Club</p>
    </div>
  `;
}

function linkButton(url, label) {
  return `
    <p style="margin: 1.25rem 0;">
      <a href="${url}" style="display: inline-block; background: #c9a227; color: #111; text-decoration: none; font-weight: 600; padding: 0.65rem 1.1rem; border-radius: 8px;">
        ${label}
      </a>
    </p>
    <p style="font-size: 0.85rem; color: #555; word-break: break-all;">Or paste this link into your browser:<br>${url}</p>
  `;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Resend email failed:', res.status, text);
  }
  return res.ok;
}

export async function sendPasswordResetEmail({ to, resetUrl }) {
  return sendEmail({
    to,
    subject: 'Reset your Poker Games Club password',
    html: emailShell({
      title: 'Reset your password',
      bodyHtml: `
        <p>We received a request to reset the password for your account.</p>
        ${linkButton(resetUrl, 'Reset password')}
        <p>This link expires in one hour. If you did not request this, you can ignore this email.</p>
      `,
    }),
  });
}

export async function sendVerificationEmail({ to, verifyUrl, displayName }) {
  const name = displayName ? ` ${displayName}` : '';
  return sendEmail({
    to,
    subject: 'Verify your Poker Games Club account',
    html: emailShell({
      title: 'Confirm your email',
      bodyHtml: `
        <p>Hi${name},</p>
        <p>Thanks for creating an account. Confirm your email to start signing in and saving your games.</p>
        ${linkButton(verifyUrl, 'Verify email')}
        <p>This link expires in 24 hours. If you did not create an account, you can ignore this email.</p>
      `,
    }),
  });
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/** @deprecated use isEmailConfigured */
export function isResetEmailConfigured() {
  return isEmailConfigured();
}
