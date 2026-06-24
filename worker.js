// SASP Intranet — Cloudflare Worker (auth only)
const API = "https://discord.com/api/v10";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}

async function discordGet(env, path) {
  const res = await fetch(API + path, {
    headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Discord ${res.status}: ${msg}`);
  }
  return res.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET,OPTIONS"
        }
      });
    }

    if (url.pathname === "/health") return json({ ok: true });

    if (url.pathname === "/auth/check-roles" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "Missing user_id" }, 400);
      const guildId = env.DISCORD_GUILD_ID || "VOTRE_GUILD_ID_SASP";
      try {
        const member = await discordGet(env, `/guilds/${guildId}/members/${userId}`);
        return json({ roles: member.roles || [] });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  }
};
