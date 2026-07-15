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

function friendlyResendError(status, bodyText) {
  let message = '';
  try {
    message = JSON.parse(bodyText || '{}').message || '';
  } catch {
    message = String(bodyText || '').slice(0, 200);
  }

  const lower = message.toLowerCase();
  if (lower.includes('only send testing emails') || lower.includes('verify a domain')) {
    return 'Email sending is still in test mode. Verify pokergamesclub.com in Resend (Domains) and set RESEND_FROM to an address on that domain.';
  }
  if (lower.includes('not verified') || lower.includes('domain is not verified')) {
    return 'Sending domain is not verified in Resend. Add and verify pokergamesclub.com, then use an address like noreply@pokergamesclub.com as RESEND_FROM.';
  }
  if (lower.includes('invalid') && lower.includes('from')) {
    return 'RESEND_FROM is invalid. Use a verified address like "Poker Games Club <noreply@pokergamesclub.com>".';
  }
  if (status === 401 || status === 403) {
    return 'Email provider rejected the request. Check RESEND_API_KEY and that your Resend domain is verified.';
  }
  if (message) return `Could not send email: ${message}`;
  return 'Could not send verification email. Try again later.';
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    return { ok: false, error: 'Email is not configured on this server.' };
  }

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
    console.error('Resend email failed:', res.status, text, { from, to });
    return { ok: false, error: friendlyResendError(res.status, text) };
  }
  return { ok: true };
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
