/**
 * Lightweight bearer-session helper for non-transaction profile actions
 * (see buyerAuth.js's verifyBuyerSignature) - a buyer signs once (a real
 * Magic popup) via createSession, then reuses the returned token for
 * further calls via verifySession, instead of re-signing on every request.
 * Deliberately not used for anything that moves funds or creates an
 * on-chain charge - those keep requiring a real signature or on-chain proof.
 */
import crypto from "node:crypto";
import { supabaseAdmin } from "./config.js";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function createSession(buyer) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await supabaseAdmin
    .from("buyer_sessions")
    .insert({ token, buyer: buyer.toLowerCase(), expires_at: expiresAt });
  if (error) throw new Error("Could not create session");
  return token;
}

export async function verifySession(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Invalid or expired session");
  }
  const { data, error } = await supabaseAdmin
    .from("buyer_sessions")
    .select("buyer, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !data || new Date(data.expires_at).getTime() < Date.now()) {
    throw new Error("Invalid or expired session");
  }
  return data.buyer;
}
