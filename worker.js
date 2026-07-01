// SASP Intranet — Cloudflare Worker (auth + pointeuse Discord)
const DISCORD_API = "https://discord.com/api/v10";
const SUPABASE_URL = "https://ufxhxptzcnvelnbprwng.supabase.co";

const DIVISION_ROLES = {
  'CID':  '1518631634524569641',
  'SWAT': '1504454935645786222',
  'PA':   '1518631987462668358',
  'CNU':  '1519495084276715663',
  'TU':   '1514523508980584528',
  'SYND': '1519496665499959418',
  'LP':   '1519688600395055154'
};
const ROLE_TO_DIVISION = Object.fromEntries(Object.entries(DIVISION_ROLES).map(([k,v]) => [v,k]));

const PPA_ROLES = {
  'ppa1':  '1519517647132168372',
  'ppa2':  '1519517683379343372',
  'ppa3a': '1519517734055186474',
  'ppa3b': '1519680711823593582'
};
const GRADE_ROLES = {
  'Commandant':          '1500983026987962388',
  'Capitaine':           '1500975725153620036',
  'Lieutenant II':       '1500983449287131266',
  'Lieutenant I':        '1500975725153620034',
  'Sergeant II':         '1500982880950550752',
  'Sergeant I':          '1500975725153620032',
  'Senior Lead Officer': '1500975725153620031',
  'Trooper III':         '1500975725153620030',
  'Trooper II':          '1500975724750704669',
  'Trooper I':           '1500975724750704668',
  'Rookie':              '1500975724750704667'
};
const ROLE_TO_GRADE = Object.fromEntries(Object.entries(GRADE_ROLES).map(([k,v]) => [v,k]));

const ALL_SYNCABLE_ROLES = { ...DIVISION_ROLES, ...PPA_ROLES, ...GRADE_ROLES };

const STAFF_ROLE_IDS = [
  '1519507318188933140', // rôle gestionnaire
  '1500975725153620033', // Command Staff
  '1504451288065118248', // État Major
  '1504452141518032956', // Supervisor Team
  '1518631987462668358'  // Police Academy
];

const ADMIN_ROLE_IDS = [
  '1500975725153620033', // Command Staff
  '1504451288065118248', // État Major
  '1504452141518032956'  // Supervisor Team
];

// ── Helpers ────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" }
  });
}

function hexToBytes(hex) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return b;
}

async function verifyDiscordSignature(request, body, publicKey) {
  const sig = request.headers.get("x-signature-ed25519");
  const ts  = request.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]
    );
    return await crypto.subtle.verify(
      "Ed25519", key, hexToBytes(sig), new TextEncoder().encode(ts + body)
    );
  } catch { return false; }
}

function hasStaffRole(member) {
  const roles = member?.roles || [];
  return STAFF_ROLE_IDS.some(r => roles.includes(r));
}

// ── Supabase ───────────────────────────────────────────────────────
async function sb(env, method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "apikey": env.SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "return=representation" : "return=minimal"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function getAgentByDiscordId(env, discordId) {
  const data = await sb(env, "GET", `/agents?discord_id=eq.${discordId}&select=id,nom,prenom,matricule,discord_id,grade&limit=1`);
  return data && data.length > 0 ? data[0] : null;
}

async function getAgentByMatricule(env, matricule) {
  const data = await sb(env, "GET", `/agents?matricule=eq.${matricule}&select=id,nom,prenom,matricule,discord_id&limit=1`);
  return data && data.length > 0 ? data[0] : null;
}

async function getActivePointage(env, agentId) {
  const data = await sb(env, "GET", `/pointages?agent_id=eq.${agentId}&clock_out=is.null&limit=1`);
  return data && data.length > 0 ? data[0] : null;
}

async function getAllActivePointages(env) {
  const data = await sb(env, "GET", `/pointages?clock_out=is.null&select=id,agent_id,clock_in,agents(nom,prenom,matricule)&order=clock_in.asc`);
  return data || [];
}

// ── Message pointeuse ──────────────────────────────────────────────
function buildPointeuseMessage(active) {
  const count = active.length;
  const list = active.map(p => {
    const a = p.agents || {};
    return `• ${(a.prenom + " " + a.nom).trim()} (${a.matricule || "—"})`;
  }).join("\n");

  return {
    embeds: [{
      title: "🚔 SASP — Tableau de service",
      description: count > 0
        ? `**En service · ${count} agent${count > 1 ? "s" : ""}**\n${list}`
        : "*Aucun agent en service*",
      color: count > 0 ? 0x3A9B4E : 0x3A4E64,
      footer: { text: "SASP · Mis à jour automatiquement" },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Prise de service", emoji: { name: "🟢" }, custom_id: "prise_service" },
        { type: 2, style: 4, label: "Fin de service",   emoji: { name: "🔴" }, custom_id: "fin_service" },
        { type: 2, style: 2, label: "Retirer un agent", emoji: { name: "🛑" }, custom_id: "admin_remove" }
      ]
    }]
  };
}

// ── Discord message edit ───────────────────────────────────────────
async function editMessage(env, channelId, messageId, payload) {
  await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

// ── Auto clock-out agents en service depuis +6h ────────────────────
async function autoClockout6h(env) {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const data = await sb(env, "GET", `/pointages?clock_out=is.null&clock_in=lt.${encodeURIComponent(sixHoursAgo)}&select=id,agent_id,clock_in,agents(nom,prenom,matricule)&order=clock_in.asc`);
  const expired = data || [];
  if (!expired.length) return 0;
  const now = new Date().toISOString();
  for (const p of expired) {
    await sb(env, "PATCH", `/pointages?id=eq.${p.id}`, { clock_out: now });
  }
  const lines = expired.map(p => {
    const a = p.agents || {};
    return `• **${(a.prenom + ' ' + a.nom).trim()}** (${a.matricule || '—'}) a oublié de terminer son service et a bien été déconnecté automatiquement.`;
  }).join('\n');
  await fetch(`${DISCORD_API}/channels/1519525957390827711/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `<@&1500975725153620033>`,
      embeds: [{
        title: '⏱️ Fin de service automatique — 6h dépassées',
        description: lines,
        color: 0xe67e22,
        footer: { text: 'SASP · Auto clock-out 6h' },
        timestamp: now
      }]
    })
  });
  const chId = env.POINTEUSE_CHANNEL_ID;
  const msgId = env.POINTEUSE_MESSAGE_ID;
  if (chId && msgId) {
    const remaining = await getAllActivePointages(env);
    await editMessage(env, chId, msgId, buildPointeuseMessage(remaining));
  }
  return expired.length;
}

// ── Auto clock-out tous les agents actifs ──────────────────────────
async function autoClockoutAll(env) {
  const active = await getAllActivePointages(env);
  if (!active.length) return 0;
  const now = new Date().toISOString();
  for (const p of active) {
    await sb(env, "PATCH", `/pointages?id=eq.${p.id}`, { clock_out: now });
  }
  const names = active.map(p => {
    const a = p.agents || {};
    return `• ${(a.prenom + ' ' + a.nom).trim()} (${a.matricule || '—'})`;
  }).join('\n');
  await fetch(`${DISCORD_API}/channels/1519525957390827711/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: '🕗 Fin de service automatique — Dimanche 20h',
        description: `**${active.length} agent${active.length > 1 ? 's' : ''} déconnecté${active.length > 1 ? 's' : ''} automatiquement :**\n${names}`,
        color: 0xe74c3c,
        footer: { text: 'CENTRALE PA · Auto clock-out hebdomadaire' },
        timestamp: now
      }]
    })
  });
  // Mise à jour du message pointeuse Discord si env vars présentes
  const chId = env.POINTEUSE_CHANNEL_ID;
  const msgId = env.POINTEUSE_MESSAGE_ID;
  if (chId && msgId) {
    await editMessage(env, chId, msgId, buildPointeuseMessage([]));
  }
  return active.length;
}

// ── Main ───────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type, x-log-token",
          "access-control-allow-methods": "GET,POST,OPTIONS"
        }
      });
    }

    // Sync divisions intranet → Discord
    if (url.pathname === "/sync-member-roles" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { discord_id, add_codes, remove_codes } = await request.json();
      const guildId = env.DISCORD_GUILD_ID || "1500975724750704661";
      const results = [];
      for (const code of (add_codes || [])) {
        const roleId = ALL_SYNCABLE_ROLES[code]; if (!roleId) continue;
        const r = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discord_id}/roles/${roleId}`, {
          method: "PUT", headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "X-Audit-Log-Reason": "SASP Intranet — sync" }
        });
        results.push({ code, action: "add", status: r.status });
      }
      for (const code of (remove_codes || [])) {
        const roleId = ALL_SYNCABLE_ROLES[code]; if (!roleId) continue;
        const r = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discord_id}/roles/${roleId}`, {
          method: "DELETE", headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "X-Audit-Log-Reason": "SASP Intranet — sync" }
        });
        results.push({ code, action: "remove", status: r.status });
      }
      return json({ ok: true, results });
    }

    // Sync divisions Discord → intranet
    if (url.pathname === "/get-member-roles" && request.method === "GET") {
      const discordId = url.searchParams.get("discord_id");
      if (!discordId) return json({ error: "Missing discord_id" }, 400);
      const guildId = env.DISCORD_GUILD_ID || "1500975724750704661";
      const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordId}`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      if (!res.ok) return json({ ok: false, error: "Membre non trouvé" }, 404);
      const member = await res.json();
      const divisions = (member.roles || []).filter(r => ROLE_TO_DIVISION[r]).map(r => ROLE_TO_DIVISION[r]);
      return json({ ok: true, divisions });
    }

    // Récupère les rôles de membres Discord par IDs (Discord → Intranet)
    if (url.pathname === "/sync-all-from-discord" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { discord_ids } = await request.json();
      const guildId = env.DISCORD_GUILD_ID || "1500975724750704661";
      const map = {};
      for (const discordId of (discord_ids || [])) {
        const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordId}`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (!res.ok) continue;
        const m = await res.json();
        const roles = m.roles || [];
        const gradeRoleId = roles.find(r => ROLE_TO_GRADE[r]);
        map[discordId] = {
          divisions: roles.filter(r => ROLE_TO_DIVISION[r]).map(r => ROLE_TO_DIVISION[r]),
          ppa1:  roles.includes(PPA_ROLES.ppa1),
          ppa2:  roles.includes(PPA_ROLES.ppa2),
          ppa3:  roles.includes(PPA_ROLES.ppa3a) || roles.includes(PPA_ROLES.ppa3b),
          grade: gradeRoleId ? ROLE_TO_GRADE[gradeRoleId] : null
        };
      }
      return json({ ok: true, map });
    }

    // Sync tous les agents intranet → Discord
    if (url.pathname === "/sync-all-agents" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { agents } = await request.json();
      const guildId = env.DISCORD_GUILD_ID || "1500975724750704661";
      const allCodes = Object.keys(DIVISION_ROLES);
      let ok = 0, errors = 0;
      for (const ag of (agents || [])) {
        if (!ag.discord_id) continue;
        const hasDivisions = ag.divisions || [];
        for (const code of allCodes) {
          const roleId = DIVISION_ROLES[code];
          const method = hasDivisions.includes(code) ? "PUT" : "DELETE";
          const r = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${ag.discord_id}/roles/${roleId}`, {
            method, headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "X-Audit-Log-Reason": "SASP Intranet — sync global" }
          });
          if (r.ok || r.status === 204) ok++; else errors++;
        }
      }
      return json({ ok: true, synced: ok, errors });
    }

    // Logs intranet → Discord
    // Liste agents → Discord (message auto-mis à jour)
    if (url.pathname === "/update-agent-list" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { agents } = await request.json();
      const channelId = "1519818698100179094";
      const lines = (agents || [])
        .filter(a => a.telephone)
        .sort((a, b) => (a.matricule || '').localeCompare(b.matricule || ''))
        .map(a => `**${a.matricule || '—'}** ${a.prenom} ${a.nom} — \`${a.telephone}\``);
      const description = lines.length ? lines.join('\n').slice(0, 4000) : '*Aucun agent avec un numéro de téléphone.*';
      const embed = {
        title: "📋 Liste des agents — Téléphones",
        description,
        color: 0x2c3e50,
        footer: { text: `SASP Intranet • ${lines.length} agent(s) répertorié(s)` },
        timestamp: new Date().toISOString()
      };
      const msgsRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=50`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const msgs = await msgsRes.json();
      const existing = Array.isArray(msgs) && msgs.find(m => m.author?.bot && m.embeds?.[0]?.title?.includes('Téléphones'));
      if (existing) {
        await fetch(`${DISCORD_API}/channels/${channelId}/messages/${existing.id}`, {
          method: "PATCH",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] })
        });
      } else {
        await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] })
        });
      }
      return json({ ok: true });
    }


    if (url.pathname === "/log" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) {
        return json({ error: "Unauthorized" }, 401);
      }
      try {
        const { embed } = await request.json();
        await fetch(`${DISCORD_API}/channels/1519525957390827711/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ ...embed, footer: { text: "SASP Intranet" }, timestamp: new Date().toISOString() }] })
        });
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/health") return json({ ok: true });

    // Auth check-roles (intranet web)
    if (url.pathname === "/auth/check-roles" && request.method === "GET") {
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ error: "Missing user_id" }, 400);
      const guildId = env.DISCORD_GUILD_ID || "1500975724750704661";
      try {
        const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
          headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (!res.ok) return json({ roles: [] });
        const member = await res.json();
        return json({ roles: member.roles || [] });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // Poster le message initial (appel manuel)
    if (url.pathname === "/post-pointeuse" && request.method === "GET") {
      const channelId = url.searchParams.get("channel_id");
      if (!channelId) return json({ error: "Missing channel_id" }, 400);
      const active = await getAllActivePointages(env);
      const payload = buildPointeuseMessage(active);
      const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      return json({ ok: res.ok, message_id: data.id, channel_id: channelId });
    }

    // Envoyer le message sticky plainte
    const STICKY_PLAINTE_CHANNEL = "1519510826233364500";
    const STICKY_PLAINTE_EMBED = { embeds: [{ title: "📋 Déposer une plainte", color: 0x3498db, description: "Utilisez la commande `/plainte` pour déposer une plainte officielle.\n\nUne fois le formulaire validé, **copiez-collez** le message généré et envoyez-le ici :\nhttps://discord.com/channels/1512185605805703179/1517219854724235477", footer: { text: "SASP • Service des plaintes" } }] };
    if (url.pathname === "/admin/send-sticky-plainte" && request.method === "GET") {
      const res = await fetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(STICKY_PLAINTE_EMBED)
      });
      const data = await res.json();
      return json({ ok: res.ok, data });
    }

    const STICKY_PROC_CHANNEL = "1521575058500489478";
    const STICKY_PROC_EMBED = { embeds: [{ title: "⚖️ Demande de procureur", color: 0x2c3e50, description: "Utilisez la commande `/proc` pour commencer la procédure de demande de procureur.\n\nRemplissez le formulaire et validez — le dossier sera automatiquement créé dans <#1521565049729187961>.", footer: { text: "SASP • Service judiciaire" } }] };
    if (url.pathname === "/admin/send-sticky-proc" && request.method === "GET") {
      const res = await fetch(`${DISCORD_API}/channels/${STICKY_PROC_CHANNEL}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(STICKY_PROC_EMBED)
      });
      const data = await res.json();
      return json({ ok: res.ok, data });
    }

    // Installer la commande /plainte
    if (url.pathname === "/admin/install-plainte-command" && request.method === "GET") {
      try {
        const guildId = env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await fetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "plainte", description: "Déposer une plainte officielle SASP" })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/install-proc-command" && request.method === "GET") {
      try {
        const guildId = env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await fetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "proc", description: "Créer une demande procureur SASP" })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // Discord interactions (boutons + select menu + slash commands + modals)
    if (url.pathname === "/interactions" && request.method === "POST") {
      const body = await request.text();
      const publicKey = env.DISCORD_PUBLIC_KEY || "464ade991df3bbe8578510babaa575a74a30366ecf3bdb39538e40e099ca5b9f";

      if (!await verifyDiscordSignature(request, body, publicKey)) {
        return json({ error: "Unauthorized" }, 401);
      }

      const interaction = JSON.parse(body);

      // Ping
      if (interaction.type === 1) return json({ type: 1 });

      // Slash command /proc
      if (interaction.type === 2 && interaction.data.name === "proc") {
        return json({
          type: 9,
          data: {
            custom_id: "proc_modal",
            title: "Demande Procureur",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "suspect", label: "Nom Prénom du suspect", style: 1, required: true, placeholder: "Ex : John Smith", min_length: 2, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "tel_suspect", label: "Numéro de téléphone du suspect", style: 1, required: true, placeholder: "Ex : 555-0123", max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "chefs_accusation", label: "Chef(s) d'accusation", style: 2, required: true, min_length: 2, max_length: 1000 }] },
              { type: 1, components: [{ type: 4, custom_id: "avocat", label: "Avocat + Téléphone (si représenté)", style: 1, required: false, placeholder: "Ex : Me. Dupont — 555-0123", max_length: 150 }] },
              { type: 1, components: [{ type: 4, custom_id: "heure_faits", label: "Heure des faits (HH:MM)", style: 1, required: true, placeholder: "Ex : 17:30", max_length: 10 }] }
            ]
          }
        });
      }

      // Modal submit /proc
      if (interaction.type === 5 && interaction.data.custom_id.startsWith("proc_modal")) {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const suspect         = getValue("suspect");
        const telSuspect      = getValue("tel_suspect");
        const chefsAccusation = getValue("chefs_accusation");
        const avocat          = getValue("avocat");
        const heureFaits      = getValue("heure_faits");

        const now = new Date();
        const dateStr = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const threadTitle = `${suspect} - ${dateStr} - ${heureFaits}`;

        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const fields = [
          { name: "🧑 Suspect", value: suspect, inline: false },
          { name: "📞 Téléphone suspect", value: telSuspect, inline: false },
          { name: "📋 Chef(s) d'accusation", value: chefsAccusation, inline: false },
          { name: "👮 Agent en charge", value: agentDisplay, inline: false }
        ];
        if (avocat) fields.push({ name: "⚖️ Avocat + Téléphone", value: avocat, inline: false });

        const forumRes = await fetch(`${DISCORD_API}/channels/1521565049729187961/threads`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: threadTitle,
            message: {
              content: "<@&1512410095173238814>",
              embeds: [{
                title: "⚖️ Demande Procureur",
                color: 0x2c3e50,
                fields,
                footer: { text: `SASP · Déposée par ${agentDisplay}` },
                timestamp: now.toISOString()
              }],
              components: [
                { type: 1, components: [{ type: 2, style: 1, label: "🔗 Bracelet Électronique", custom_id: "proc_bracelet" }] },
                { type: 1, components: [
                  { type: 2, style: 3, label: "✅ Affaire clôturée",   custom_id: "proc_tag|AFFAIRE CLOTURER" },
                  { type: 2, style: 4, label: "🚫 Dossier incomplet",  custom_id: "proc_tag|DOSSIER INCOMPLET" },
                  { type: 2, style: 2, label: "🔄 Affaire en cours",   custom_id: "proc_tag|AFFAIRE EN COUR" }
                ]},
                { type: 1, components: [
                  { type: 2, style: 2, label: "⚖️ Attente jugement",   custom_id: "proc_tag|ATTENTE DE JUGEMENT" },
                  { type: 2, style: 2, label: "⏳ Attente procureur",  custom_id: "proc_tag|ATTENTE PROCUREUR" }
                ]}
              ]
            }
          })
        });

        if (!forumRes.ok) {
          const err = await forumRes.text();
          return json({ type: 4, data: { content: `❌ Erreur création forum (${forumRes.status}): ${err}`, flags: 64 } });
        }
        await fetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "⚖️ Nouvelle demande procureur", color: 0x2c3e50, fields: [
            { name: "🧑 Suspect", value: suspect, inline: true },
            { name: "📞 Téléphone", value: telSuspect, inline: true },
            { name: "📋 Chef(s) d'accusation", value: chefsAccusation, inline: false },
            { name: "👮 Agent en charge", value: agentDisplay, inline: true },
            { name: "🕐 Heure des faits", value: heureFaits, inline: true },
            ...(avocat ? [{ name: "⚖️ Avocat + Tél", value: avocat, inline: false }] : [])
          ], footer: { text: "SASP · Proc" }, timestamp: now.toISOString() }] })
        });
        // Supprime l'ancien sticky proc puis le renvoie
        try {
          const msgsRes = await fetch(`${DISCORD_API}/channels/${STICKY_PROC_CHANNEL}/messages?limit=20`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const msgs = await msgsRes.json();
          const sticky = Array.isArray(msgs) && msgs.find(m => m.embeds?.[0]?.title === "⚖️ Demande de procureur");
          if (sticky) {
            await fetch(`${DISCORD_API}/channels/${STICKY_PROC_CHANNEL}/messages/${sticky.id}`, {
              method: "DELETE",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
          }
          await fetch(`${DISCORD_API}/channels/${STICKY_PROC_CHANNEL}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(STICKY_PROC_EMBED)
          });
        } catch {}

        return json({ type: 4, data: { content: `✅ Demande procureur créée pour **${suspect}**.`, flags: 64 } });
      }

      // Bouton bracelet depuis un post proc
      if (interaction.type === 3 && interaction.data.custom_id === "proc_bracelet") {
        const embed = interaction.message?.embeds?.[0] || {};
        const getField = (kw) => (embed.fields || []).find(f => f.name.includes(kw))?.value || "";
        const suspectName = getField("Suspect");
        const telSuspect  = getField("Téléphone");
        const chefs       = getField("accusation");
        const now = new Date();
        const dateDefault = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        return json({
          type: 9,
          data: {
            custom_id: "bracelet_modal",
            title: "Bracelet Électronique",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "bracelet_suspect", label: "Nom Prénom du suspect", style: 1, required: true, value: suspectName, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_date", label: "Posé le", style: 1, required: true, value: dateDefault, max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_tel", label: "Numéro de téléphone", style: 1, required: true, value: telSuspect, max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_raison", label: "Chef(s) d'inculpation", style: 2, required: true, value: chefs, max_length: 500 }] }
            ]
          }
        });
      }

      // Modal submit bracelet
      if (interaction.type === 5 && interaction.data.custom_id === "bracelet_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const suspect = getValue("bracelet_suspect");
        const date    = getValue("bracelet_date");
        const tel     = getValue("bracelet_tel");
        const raison  = getValue("bracelet_raison");

        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const content = `BRACELET ELECTRONIQUE DE ${suspect.toUpperCase()}\n\nPosé le : ${date}\nNuméro de téléphone : ${tel}\nRaison : ${raison}\nPosé par : ${agentDisplay}\n\nPensez à bien noter quand les individus viennent pointer\n\nℹ️ Les bracelets peuvent être activés pour voir la position une fois toutes les 24h via un message "BIP" sur le téléphone de l'individu.`;

        const forumRes = await fetch(`${DISCORD_API}/channels/1518656285074128926/threads`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: suspect,
            message: {
              content,
              components: [
                { type: 1, components: [{ type: 2, style: 3, label: "📍 Pointage", custom_id: "bracelet_pointage" }] }
              ]
            }
          })
        });

        if (!forumRes.ok) {
          const err = await forumRes.text();
          return json({ type: 4, data: { content: `❌ Erreur création bracelet (${forumRes.status}): ${err}`, flags: 64 } });
        }
        const braceletData = await forumRes.json();
        const braceletThreadId = braceletData.id;
        const procThreadId = interaction.channel_id;
        // Poster le lien du bracelet dans le thread proc pour relier les deux
        await fetch(`${DISCORD_API}/channels/${procThreadId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: `🔗 Bracelet créé : <#${braceletThreadId}>` })
        });
        await fetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "🔗 Bracelet électronique posé", color: 0xe67e22, fields: [
            { name: "🧑 Suspect", value: suspect, inline: true },
            { name: "📞 Téléphone", value: tel, inline: true },
            { name: "📋 Chef(s) d'inculpation", value: raison, inline: false },
            { name: "📅 Posé le", value: date, inline: true },
            { name: "👮 Posé par", value: agentDisplay, inline: true }
          ], footer: { text: "SASP · Bracelet" }, timestamp: new Date().toISOString() }] })
        });
        return json({ type: 4, data: { content: `✅ Bracelet électronique créé pour **${suspect}**.`, flags: 64 } });
      }

      // Boutons tags proc/bracelet
      if (interaction.type === 3 && interaction.data.custom_id.startsWith("proc_tag|")) {
        const TAG_ALLOWED_ROLES = ["1512410095173238814", "1500975725153620033", "1504452141518032956"];
        const memberRoles = interaction.member?.roles || [];
        if (!TAG_ALLOWED_ROLES.some(r => memberRoles.includes(r))) {
          return json({ type: 4, data: { content: "❌ Tu n'as pas la permission de modifier le statut de ce dossier.", flags: 64 } });
        }

        const tagName = interaction.data.custom_id.split("|")[1];
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const tagMessages = {
          'AFFAIRE CLOTURER':    '🔒 **Affaire clôturée.**',
          'DOSSIER INCOMPLET':   '⚠️ **Dossier incomplet** — des informations sont manquantes.',
          'AFFAIRE EN COUR':     '🔄 **Affaire en cours** de traitement.',
          'ATTENTE DE JUGEMENT': '⚖️ **En attente de jugement.**',
          'ATTENTE PROCUREUR':   '⏳ **En attente du procureur.**'
        };
        const msg = tagMessages[tagName] || `**${tagName}**`;
        const now = new Date();

        const applyTagAndMessage = async (threadId) => {
          try {
            const threadInfo = await (await fetch(`${DISCORD_API}/channels/${threadId}`, { headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` } })).json();
            const forumInfo  = await (await fetch(`${DISCORD_API}/channels/${threadInfo.parent_id}`, { headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` } })).json();
            const tag = (forumInfo.available_tags || []).find(t => t.name.toUpperCase() === tagName.toUpperCase());
            if (tag) {
              await fetch(`${DISCORD_API}/channels/${threadId}`, {
                method: "PATCH",
                headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ applied_tags: [tag.id] })
              });
            }
          } catch {}
          await fetch(`${DISCORD_API}/channels/${threadId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content: `${msg} — par ${agentDisplay}` })
          });
        };

        // Applique sur le thread actuel
        await applyTagAndMessage(interaction.channel_id);

        // Si on est dans un thread proc, cherche le bracelet lié et propage
        try {
          const msgsRes = await fetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages?limit=50`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const msgs = await msgsRes.json();
          const braceletLinkMsg = Array.isArray(msgs) && msgs.find(m => m.content && m.content.includes("🔗 Bracelet créé : <#"));
          if (braceletLinkMsg) {
            const match = braceletLinkMsg.content.match(/<#(\d+)>/);
            if (match) {
              const braceletThreadId = match[1];
              await applyTagAndMessage(braceletThreadId);

              // Si affaire clôturée : ping l'agent qui a posé le bracelet pour lui dire de l'enlever
              if (tagName === "AFFAIRE CLOTURER") {
                try {
                  const braceletMsgsRes = await fetch(`${DISCORD_API}/channels/${braceletThreadId}/messages?limit=10`, {
                    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
                  });
                  const braceletMsgs = await braceletMsgsRes.json();
                  // Premier message du thread = le message du bot avec "Posé par : Prénom Nom (matricule)"
                  const firstMsg = Array.isArray(braceletMsgs) && braceletMsgs[braceletMsgs.length - 1];
                  if (firstMsg && firstMsg.content) {
                    const poseMatch = firstMsg.content.match(/Posé par : .+?\((\d+)\)/);
                    if (poseMatch) {
                      const agent = await getAgentByMatricule(env, poseMatch[1]);
                      const ping = agent && agent.discord_id ? `<@${agent.discord_id}>` : `Matricule ${poseMatch[1]}`;
                      await fetch(`${DISCORD_API}/channels/${braceletThreadId}/messages`, {
                        method: "POST",
                        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ content: `${ping} — L'affaire est clôturée, pense à **enlever le bracelet électronique**.` })
                      });
                    }
                  }
                } catch {}

                // Fermer (archiver + verrouiller) les deux posts
                const closeThread = async (tid) => {
                  await fetch(`${DISCORD_API}/channels/${tid}`, {
                    method: "PATCH",
                    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ archived: true, locked: true })
                  });
                };
                await closeThread(interaction.channel_id);
                await closeThread(braceletThreadId);
              }
            }
          }
        } catch {}

        await fetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "🏷️ Statut mis à jour", color: 0x9b59b6, fields: [
            { name: "📌 Statut", value: tagName, inline: true },
            { name: "👮 Par", value: agentDisplay, inline: true }
          ], footer: { text: "SASP · Proc/Bracelet" }, timestamp: now.toISOString() }] })
        });
        return json({ type: 4, data: { content: `✅ Statut mis à jour : **${tagName}**`, flags: 64 } });
      }

      // Bouton pointage bracelet
      if (interaction.type === 3 && interaction.data.custom_id === "bracelet_pointage") {
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}
        const now = new Date();
        const heureStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        const dateStr  = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const threadName = interaction.message?.thread?.name || interaction.channel?.name || "Inconnu";
        await fetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: `✅ Pointage enregistré le ${dateStr} à ${heureStr} — par ${agentDisplay}` })
        });
        await fetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "📍 Pointage bracelet enregistré", color: 0x2ecc71, fields: [
            { name: "🧑 Suspect", value: threadName, inline: true },
            { name: "🕐 Heure", value: `${dateStr} à ${heureStr}`, inline: true },
            { name: "👮 Enregistré par", value: agentDisplay, inline: false }
          ], footer: { text: "SASP · Bracelet" }, timestamp: now.toISOString() }] })
        });
        return json({ type: 4, data: { content: "✅ Pointage enregistré.", flags: 64 } });
      }

      // Slash command /plainte
      if (interaction.type === 2 && interaction.data.name === "plainte") {
        return json({
          type: 9,
          data: {
            custom_id: "plainte_modal",
            title: "Dépôt de plainte",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "plaignant", label: "Plaignant — Nom Prénom", style: 1, required: true, placeholder: "Ex : James Morrison", min_length: 2, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "misen_cause", label: "Mis en cause (Nom Prénom ou entreprise)", style: 1, required: true, placeholder: "Ex : John Smith", min_length: 2, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "desc_misen_cause", label: "Description du mis en cause", style: 2, required: false, placeholder: "Apparence, véhicule, signalement...", max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: "motif", label: "Motif de la plainte", style: 1, required: true, placeholder: "Ex : Vol à main armée", min_length: 2, max_length: 200 }] },
              { type: 1, components: [{ type: 4, custom_id: "resume", label: "Résumé des faits", style: 2, required: true, placeholder: "Décrivez les faits...", min_length: 10, max_length: 2000 }] }
            ]
          }
        });
      }

      // Modal submit plainte (nouvelle)
      if (interaction.type === 5 && interaction.data.custom_id === "plainte_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const plaignant      = getValue("plaignant");
        const misenCause     = getValue("misen_cause");
        const descMisenCause = getValue("desc_misen_cause");
        const motif          = getValue("motif");
        const resume         = getValue("resume");
        const now = new Date();
        const dateStr  = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const heureStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.grade} ${agent.prenom} ${agent.nom}`;
        } catch {}

        let plainteId = "?";
        try {
          const idData = await sb(env, "POST", "/plaintes", { created_at: now.toISOString() });
          if (idData && idData[0]) plainteId = idData[0].id;
        } catch {}

        const misenCauseVal = descMisenCause ? `${misenCause}\n${descMisenCause}` : misenCause;
        const fields = [
          { name: "📅 Date & Heure",      value: `${dateStr} à ${heureStr}`, inline: true },
          { name: "👮 Agent en charge",   value: agentDisplay, inline: true },
          { name: "🙋 Plaignant",         value: plaignant, inline: false },
          { name: "🎯 Mis en cause",      value: misenCauseVal, inline: false },
          { name: "📋 Motif",             value: motif, inline: false },
          { name: "📝 Résumé des faits",  value: resume.slice(0, 1024), inline: false },
          { name: "⚖️ Note",              value: "La Cour est respectueusement saisie de ce dossier et invitée à statuer sur les suites judiciaires à y apporter. Le SASP demeure à disposition pour toute information complémentaire jugée nécessaire à l'instruction de cette affaire.", inline: false }
        ];

        const postRes = await fetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "<@&1512185605805703187>",
            embeds: [{ title: `📋 Plainte #${plainteId} — SASP`, color: 0xc0392b, fields, footer: { text: "SASP • Service des plaintes" }, timestamp: now.toISOString() }],
            components: [{ type: 1, components: [{ type: 2, style: 2, label: "✏️ Modifier", custom_id: `edit_plainte|${userId}` }] }]
          })
        });
        if (!postRes.ok) {
          const err = await postRes.text();
          return json({ type: 4, data: { content: `❌ Erreur Discord (${postRes.status}): ${err}`, flags: 64 } });
        }

        // Supprime l'ancien sticky puis le renvoie
        try {
          const msgsRes = await fetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages?limit=20`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const msgs = await msgsRes.json();
          const sticky = Array.isArray(msgs) && msgs.find(m => m.embeds?.[0]?.title === "📋 Déposer une plainte");
          if (sticky) {
            await fetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages/${sticky.id}`, {
              method: "DELETE",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
          }
          await fetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(STICKY_PLAINTE_EMBED)
          });
        } catch {}

        return json({ type: 4, data: { content: "✅ Plainte enregistrée !\n\nMaintenant, faites un **copier-coller** du message de la plainte et envoyez-le ici : https://discord.com/channels/1512185605805703179/1517219854724235477", flags: 64 } });
      }

      // Modal submit plainte (modification)
      if (interaction.type === 5 && interaction.data.custom_id.startsWith("edit_plainte_modal|")) {
        const parts = interaction.data.custom_id.split("|");
        const channelId = parts[1];
        const messageId = parts[2];
        const creatorId = parts[3];
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const plaignant      = getValue("plaignant");
        const misenCause     = getValue("misen_cause");
        const descMisenCause = getValue("desc_misen_cause");
        const motif          = getValue("motif");
        const resume         = getValue("resume");

        // Récupère dossier # et agent en charge depuis l'embed original
        const origRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const origMsg = await origRes.json();
        const origEmbed = origMsg.embeds?.[0] || {};
        const origTitle = origEmbed.title || `📋 Plainte — SASP`;
        const origGetField = (kw) => (origEmbed.fields || []).find(f => f.name.includes(kw))?.value || "";
        const agentStr = origGetField("Agent");
        const dateStr  = origGetField("Date");

        const misenCauseVal = descMisenCause ? `${misenCause}\n${descMisenCause}` : misenCause;
        const newFields = [
          { name: "📅 Date & Heure",      value: dateStr, inline: true },
          { name: "👮 Agent en charge",   value: agentStr, inline: true },
          { name: "🙋 Plaignant",         value: plaignant, inline: false },
          { name: "🎯 Mis en cause",      value: misenCauseVal, inline: false },
          { name: "📋 Motif",             value: motif, inline: false },
          { name: "📝 Résumé des faits",  value: resume.slice(0, 1024), inline: false },
          { name: "⚖️ Note",              value: "La Cour est respectueusement saisie de ce dossier et invitée à statuer sur les suites judiciaires à y apporter. Le SASP demeure à disposition pour toute information complémentaire jugée nécessaire à l'instruction de cette affaire.", inline: false }
        ];

        await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
          method: "PATCH",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "<@&1512185605805703187>",
            embeds: [{ title: origTitle, color: 0xe67e22, fields: newFields, footer: { text: "SASP • Service des plaintes (modifiée)" }, timestamp: new Date().toISOString() }],
            components: [{ type: 1, components: [{ type: 2, style: 2, label: "✏️ Modifier", custom_id: `edit_plainte|${creatorId}` }] }]
          })
        });
        return json({ type: 4, data: { content: "✅ Plainte modifiée.", flags: 64 } });
      }

      // Composant (bouton ou select)
      if (interaction.type === 3) {
        const customId = interaction.data.custom_id;
        const discordUserId = interaction.member?.user?.id || interaction.user?.id;
        const member = interaction.member;

        // ── Bouton modifier plainte ──
        if (customId.startsWith("edit_plainte|")) {
          const creatorId = customId.split("|")[1];
          const clickerId = interaction.member?.user?.id || interaction.user?.id;
          const isAdmin = ADMIN_ROLE_IDS.some(r => (interaction.member?.roles || []).includes(r));
          if (clickerId !== creatorId && !isAdmin) {
            return json({ type: 4, data: { content: "❌ Seul le créateur de la plainte ou un admin peut la modifier.", flags: 64 } });
          }
          const embed = interaction.message.embeds?.[0] || {};
          const getField = (kw) => (embed.fields || []).find(f => f.name.includes(kw))?.value || "";
          const misenCauseRaw = getField("Mis en cause");
          const misenLines = misenCauseRaw.split("\n");
          const misenVal = misenLines[0] || "";
          const descVal  = misenLines.slice(1).join("\n");
          const channelId = interaction.channel_id;
          const messageId = interaction.message.id;
          return json({
            type: 9,
            data: {
              custom_id: `edit_plainte_modal|${channelId}|${messageId}|${creatorId}`,
              title: "Modifier la plainte",
              components: [
                { type: 1, components: [{ type: 4, custom_id: "plaignant", label: "Plaignant — Nom Prénom", style: 1, required: true, value: getField("Plaignant"), min_length: 2, max_length: 80 }] },
                { type: 1, components: [{ type: 4, custom_id: "misen_cause", label: "Mis en cause", style: 1, required: true, value: misenVal, min_length: 2, max_length: 80 }] },
                { type: 1, components: [{ type: 4, custom_id: "desc_misen_cause", label: "Description du mis en cause", style: 2, required: false, value: descVal, max_length: 500 }] },
                { type: 1, components: [{ type: 4, custom_id: "motif", label: "Motif de la plainte", style: 1, required: true, value: getField("Motif"), min_length: 2, max_length: 200 }] },
                { type: 1, components: [{ type: 4, custom_id: "resume", label: "Résumé des faits", style: 2, required: true, value: getField("Résumé"), min_length: 10, max_length: 2000 }] }
              ]
            }
          });
        }

        // ── Select menu : retirer un agent ──
        if (customId.startsWith("remove_agent|")) {
          if (!hasStaffRole(member)) {
            return json({ type: 4, data: { content: "❌ Permissions insuffisantes.", flags: 64 } });
          }
          const parts = customId.split("|");
          const channelId = parts[1];
          const messageId = parts[2];
          const agentId = interaction.data.values[0];

          const active = await getActivePointage(env, agentId);
          if (active) {
            await sb(env, "PATCH", `/pointages?id=eq.${active.id}`, { clock_out: new Date().toISOString() });
          }

          const allActive = await getAllActivePointages(env);
          await editMessage(env, channelId, messageId, buildPointeuseMessage(allActive));

          return json({ type: 7, data: { content: "✅ Agent retiré du service.", components: [], flags: 64 } });
        }

        // ── Bouton admin : afficher le select ──
        if (customId === "admin_remove") {
          if (!hasStaffRole(member)) {
            return json({ type: 4, data: { content: "❌ Tu n'as pas les permissions pour cette action.", flags: 64 } });
          }
          const active = await getAllActivePointages(env);
          if (!active.length) {
            return json({ type: 4, data: { content: "Aucun agent en service actuellement.", flags: 64 } });
          }
          const options = active.map(p => {
            const a = p.agents || {};
            return {
              label: `${(a.prenom + " " + a.nom).trim()} (${a.matricule || "—"})`,
              value: p.agent_id
            };
          });
          const channelId = interaction.channel_id;
          const messageId = interaction.message.id;
          return json({
            type: 4,
            data: {
              flags: 64,
              content: "Sélectionne l'agent à retirer du service :",
              components: [{
                type: 1,
                components: [{
                  type: 3,
                  custom_id: `remove_agent|${channelId}|${messageId}`,
                  options,
                  placeholder: "Choisir un agent..."
                }]
              }]
            }
          });
        }

        // ── Prise / fin de service ──
        if (customId !== "prise_service" && customId !== "fin_service") {
          return json({ type: 4, data: { content: "❌ Action inconnue.", flags: 64 } });
        }

        let agent;
        try {
          agent = await getAgentByDiscordId(env, discordUserId);
        } catch (e) {
          return json({ type: 4, data: { content: `❌ Erreur : ${e.message}`, flags: 64 } });
        }

        if (!agent) {
          return json({ type: 4, data: { content: "❌ Ton Discord ID n'est lié à aucun agent. Configure-le dans ton profil sur l'intranet.", flags: 64 } });
        }

        if (customId === "prise_service") {
          const existing = await getActivePointage(env, agent.id);
          if (existing) {
            return json({ type: 4, data: { content: `⚠️ Tu es déjà en service, ${agent.prenom} !`, flags: 64 } });
          }
          await sb(env, "POST", "/pointages", { agent_id: agent.id, clock_in: new Date().toISOString() });
        } else {
          const active = await getActivePointage(env, agent.id);
          if (!active) {
            return json({ type: 4, data: { content: `⚠️ Tu n'es pas en service, ${agent.prenom} !`, flags: 64 } });
          }
          await sb(env, "PATCH", `/pointages?id=eq.${active.id}`, { clock_out: new Date().toISOString() });
        }

        const allActive = await getAllActivePointages(env);
        return json({ type: 7, data: buildPointeuseMessage(allActive) });
      }

      return json({ type: 4, data: { content: "Type d'interaction non supporté.", flags: 64 } });
    }

    // ── Forcer fin de service pour un agent précis ─────────────────
    if (url.pathname === "/clockout-agent" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { agent_id } = await request.json();
      if (!agent_id) return json({ error: "Missing agent_id" }, 400);
      const active = await getActivePointage(env, agent_id);
      if (!active) return json({ ok: false, message: "Agent non en service" });
      await sb(env, "PATCH", `/pointages?id=eq.${active.id}`, { clock_out: new Date().toISOString() });
      return json({ ok: true });
    }

    // ── Reset manuel tous les agents (admin) ───────────────────────
    if (url.pathname === "/clockout-all" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const count = await autoClockoutAll(env);
      return json({ ok: true, count });
    }

    return json({ error: "Not found" }, 404);
  },

  // ── Cron ──────────────────────────────────────────────────────────
  async scheduled(event, env, ctx) {
    if (event.cron === '0 18 * * SUN') {
      ctx.waitUntil(autoClockoutAll(env));
    } else {
      ctx.waitUntil(autoClockout6h(env));
    }
  }
};
