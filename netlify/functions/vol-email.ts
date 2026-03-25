// Shared email helper for volunteer platform

export async function sendVolunteerEmail(
  to: string,
  subject: string,
  bodyHtml: string
): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn("RESEND_API_KEY not set — skipping email");
    return false;
  }

  const fromAddress = process.env.VOLUNTEER_FROM_EMAIL || "FNL Volunteers <team@fridaynightlights.run>";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-weight:800;font-size:20px;color:#00FFD1;letter-spacing:2px">FNL VOLUNTEERS</span>
    </div>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:32px 24px;color:#FFFFFF;font-size:15px">
      ${bodyHtml}
    </div>
    <div style="text-align:center;margin-top:24px;color:#666;font-size:12px">
      <p>Friday Night Lights &mdash; The UK's Healthiest Night Out</p>
    </div>
  </div>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromAddress, to, subject, html }),
    });
    return res.ok;
  } catch (err) {
    console.error("Email send failed:", err);
    return false;
  }
}

export function signupConfirmationEmail(
  volunteerName: string,
  eventName: string,
  eventDate: string,
  roleName: string,
  status: "pending" | "confirmed",
  briefingTime?: string,
  briefingLocation?: string
): { subject: string; body: string } {
  const isConfirmed = status === "confirmed";

  const subject = isConfirmed
    ? `You're confirmed for ${eventName}!`
    : `Signup received for ${eventName}`;

  const briefingInfo = briefingTime
    ? `<p style="margin:12px 0;padding:12px 16px;background:#2A2A2A;border-radius:8px;border-left:3px solid #00FFD1">
        <strong style="color:#00FFD1">Volunteer Briefing:</strong> ${briefingTime}${briefingLocation ? ` at ${briefingLocation}` : ''}
       </p>`
    : '';

  const body = `
    <h2 style="margin:0 0 16px 0;font-size:20px">${isConfirmed ? 'You\'re In!' : 'Signup Received'}</h2>
    <p style="margin:0 0 12px 0;line-height:1.6">Hey ${volunteerName},</p>
    <p style="margin:0 0 16px 0;line-height:1.6">
      ${isConfirmed
        ? `Your spot as <strong style="color:#00FFD1">${roleName}</strong> at <strong>${eventName}</strong> is confirmed.`
        : `We've received your signup for <strong style="color:#00FFD1">${roleName}</strong> at <strong>${eventName}</strong>. An admin will confirm your spot shortly.`
      }
    </p>
    <p style="margin:0 0 8px 0;color:#999;font-size:13px"><strong>Event:</strong> ${eventName}</p>
    <p style="margin:0 0 8px 0;color:#999;font-size:13px"><strong>Date:</strong> ${eventDate}</p>
    <p style="margin:0 0 12px 0;color:#999;font-size:13px"><strong>Role:</strong> ${roleName}</p>
    ${briefingInfo}
    <p style="margin:16px 0 0 0;line-height:1.6">Thanks for volunteering — we couldn't do it without you.</p>
  `;

  return { subject, body };
}

export function confirmationEmail(
  volunteerName: string,
  eventName: string,
  eventDate: string,
  roleName: string,
  briefingTime?: string,
  briefingLocation?: string
): { subject: string; body: string } {
  return signupConfirmationEmail(volunteerName, eventName, eventDate, roleName, "confirmed", briefingTime, briefingLocation);
}
