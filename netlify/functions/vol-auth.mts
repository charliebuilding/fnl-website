import type { Context } from "@netlify/functions";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "./vol-firebase.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(data: object, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

// Simple in-memory rate limiter (resets on cold start, which is fine for serverless)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10; // max attempts per window

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const jwtSecret = Netlify.env.get("JWT_SECRET");
  if (!jwtSecret) {
    return jsonResponse({ error: "Server configuration error" }, 500);
  }

  // Rate limit by IP
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: "Too many attempts. Please try again later." }, 429);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { action } = body;

  if (action === "register") {
    return handleRegister(body, jwtSecret);
  } else if (action === "login") {
    return handleLogin(body, jwtSecret);
  } else if (action === "forgot-password") {
    return handleForgotPassword(body, jwtSecret);
  } else if (action === "reset-password") {
    return handleResetPassword(body, jwtSecret);
  } else {
    return jsonResponse({ error: "Invalid action" }, 400);
  }
};

async function handleRegister(body: any, jwtSecret: string) {
  const { email, password, firstName, lastName, phone, emergencyName, emergencyPhone, tshirtSize } = body;

  if (!email || !password || !firstName || !lastName) {
    return jsonResponse({ error: "Email, password, first name and last name are required" }, 400);
  }

  if (password.length < 8) {
    return jsonResponse({ error: "Password must be at least 8 characters" }, 400);
  }

  const emailLower = email.toLowerCase().trim();

  // Check if email already exists
  const existing = await db.collection("volunteers").where("email", "==", emailLower).limit(1).get();
  if (!existing.empty) {
    return jsonResponse({ error: "An account with this email already exists" }, 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const volunteerRef = db.collection("volunteers").doc();
  const volunteer = {
    email: emailLower,
    passwordHash,
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: phone?.trim() || "",
    emergencyName: emergencyName?.trim() || "",
    emergencyPhone: emergencyPhone?.trim() || "",
    tshirtSize: tshirtSize || "",
    skills: [],
    role: "volunteer",
    notes: "",
    totalHours: 0,
    eventsCompleted: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await volunteerRef.set(volunteer);

  const token = jwt.sign(
    {
      volunteerId: volunteerRef.id,
      email: emailLower,
      firstName: volunteer.firstName,
      role: "volunteer",
    },
    jwtSecret,
    { expiresIn: "30d" }
  );

  return jsonResponse({
    token,
    volunteer: {
      id: volunteerRef.id,
      email: emailLower,
      firstName: volunteer.firstName,
      lastName: volunteer.lastName,
      role: "volunteer",
    },
  });
}

async function handleLogin(body: any, jwtSecret: string) {
  const { email, password } = body;

  if (!email || !password) {
    return jsonResponse({ error: "Email and password are required" }, 400);
  }

  const emailLower = email.toLowerCase().trim();

  const snapshot = await db.collection("volunteers").where("email", "==", emailLower).limit(1).get();
  if (snapshot.empty) {
    return jsonResponse({ error: "Invalid email or password" }, 401);
  }

  const doc = snapshot.docs[0];
  const volunteer = doc.data();

  const valid = await bcrypt.compare(password, volunteer.passwordHash);
  if (!valid) {
    return jsonResponse({ error: "Invalid email or password" }, 401);
  }

  const token = jwt.sign(
    {
      volunteerId: doc.id,
      email: volunteer.email,
      firstName: volunteer.firstName,
      role: volunteer.role,
    },
    jwtSecret,
    { expiresIn: "30d" }
  );

  return jsonResponse({
    token,
    volunteer: {
      id: doc.id,
      email: volunteer.email,
      firstName: volunteer.firstName,
      lastName: volunteer.lastName,
      role: volunteer.role,
    },
  });
}

async function handleForgotPassword(body: any, jwtSecret: string) {
  const { email } = body;
  if (!email) return jsonResponse({ error: "Email is required" }, 400);

  const emailLower = email.toLowerCase().trim();
  const snapshot = await db.collection("volunteers").where("email", "==", emailLower).limit(1).get();

  // Always return success (don't reveal if email exists)
  if (snapshot.empty) {
    return jsonResponse({ message: "If that email exists, a reset link has been sent." });
  }

  const doc = snapshot.docs[0];

  // Generate a short-lived reset token (1 hour)
  const resetToken = jwt.sign(
    { volunteerId: doc.id, email: emailLower, purpose: "password-reset" },
    jwtSecret,
    { expiresIn: "1h" }
  );

  // Store reset token on the volunteer doc (so it can only be used once)
  await db.collection("volunteers").doc(doc.id).update({
    resetToken,
    resetTokenAt: new Date().toISOString(),
  });

  // Send reset email via Resend
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (resendKey) {
    const siteUrl = Netlify.env.get("URL") || "https://fnl-website.netlify.app";
    const resetUrl = `${siteUrl}/volunteers/?reset=${encodeURIComponent(resetToken)}`;
    const fromAddress = Netlify.env.get("VOLUNTEER_FROM_EMAIL") || "FNL Volunteers <team@fridaynightlights.run>";

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: emailLower,
        subject: "Reset your FNL Volunteer password",
        html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-weight:800;font-size:20px;color:#00FFD1;letter-spacing:2px">FNL VOLUNTEERS</span>
    </div>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:32px 24px;color:#FFFFFF;font-size:15px">
      <h2 style="margin:0 0 16px 0;font-size:20px">Reset Your Password</h2>
      <p style="margin:0 0 20px 0;line-height:1.6">Click the button below to set a new password. This link expires in 1 hour.</p>
      <a href="${resetUrl}" style="display:inline-block;padding:12px 32px;background:#00FFD1;color:#0A0A0A;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">Reset Password</a>
      <p style="margin:20px 0 0 0;color:#999;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>
</body></html>`,
      }),
    });
  }

  return jsonResponse({ message: "If that email exists, a reset link has been sent." });
}

async function handleResetPassword(body: any, jwtSecret: string) {
  const { token, password } = body;
  if (!token || !password) return jsonResponse({ error: "Token and new password are required" }, 400);

  if (password.length < 8) {
    return jsonResponse({ error: "Password must be at least 8 characters" }, 400);
  }

  // Verify the reset token
  let decoded: any;
  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch {
    return jsonResponse({ error: "Invalid or expired reset link" }, 400);
  }

  if (decoded.purpose !== "password-reset") {
    return jsonResponse({ error: "Invalid reset token" }, 400);
  }

  // Check the token matches what's stored (single-use)
  const doc = await db.collection("volunteers").doc(decoded.volunteerId).get();
  if (!doc.exists) return jsonResponse({ error: "Account not found" }, 404);

  const volunteer = doc.data()!;
  if (volunteer.resetToken !== token) {
    return jsonResponse({ error: "This reset link has already been used" }, 400);
  }

  // Update password and clear reset token
  const passwordHash = await bcrypt.hash(password, 10);
  await db.collection("volunteers").doc(decoded.volunteerId).update({
    passwordHash,
    resetToken: null,
    resetTokenAt: null,
    updatedAt: new Date().toISOString(),
  });

  return jsonResponse({ message: "Password updated successfully. You can now sign in." });
}

export const config = {
  path: "/api/volunteers/auth",
};
