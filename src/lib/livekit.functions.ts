import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getLiveKitToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { roomId: string; name: string }) => {
    const roomId = String(input.roomId).slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "");
    const name = String(input.name).slice(0, 32) || "Player";
    if (!roomId) throw new Error("Invalid room");
    return { roomId, name };
  })
  .handler(async ({ data, context }) => {
    const { AccessToken } = await import("livekit-server-sdk");
    const url = process.env.LIVEKIT_URL;
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!url || !key || !secret) throw new Error("LiveKit not configured");
    const at = new AccessToken(key, secret, {
      identity: context.userId,
      name: data.name,
      ttl: 60 * 60,
    });
    at.addGrant({
      roomJoin: true,
      room: `neonfrag-${data.roomId}`,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    const token = await at.toJwt();
    return { token, url };
  });

export const getLiveKitTokenPublic = createServerFn({ method: "POST" })
  .inputValidator((input: { roomId: string; name: string; identity: string }) => {
    const roomId = String(input.roomId).slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, "");
    const name = String(input.name).slice(0, 32) || "Guest";
    const identity =
      String(input.identity).slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, "") ||
      `anon-${Math.random().toString(36).slice(2, 10)}`;
    if (!roomId) throw new Error("Invalid room");
    return { roomId, name, identity };
  })
  .handler(async ({ data }) => {
    const { AccessToken } = await import("livekit-server-sdk");
    const url = process.env.LIVEKIT_URL;
    const key = process.env.LIVEKIT_API_KEY;
    const secret = process.env.LIVEKIT_API_SECRET;
    if (!url || !key || !secret) throw new Error("LiveKit not configured");
    const at = new AccessToken(key, secret, {
      identity: data.identity,
      name: data.name,
      ttl: 60 * 60,
    });
    at.addGrant({
      roomJoin: true,
      room: `neonfrag-${data.roomId}`,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    const token = await at.toJwt();
    return { token, url };
  });