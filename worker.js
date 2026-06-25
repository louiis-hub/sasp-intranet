// SASP Intranet — Cloudflare Worker (auth + pointeuse Discord)
const DISCORD_API = "https://discord.com/api/v10";
const SUPABASE_URL = "https://ufxhxptzcnvelnbprwng.supabase.co";

const DIVISION_ROLES = {
  'CID':  '1518631634524569641',
  'SWAT': '1504454935645786222',
  'PA':   '1518631987462668358',
  'CNU':  '1519495084276715663',
  'TU':   '1514523508980584528',
  'SYND': '1519496665499959418'
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
  'Officer III':         '1500975725153620030',
  'Officer II':          '1500975724750704669',
  'Officer I':           '1500975724750704668',
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
  const data = await sb(env, "GET", `/agents?discord_id=eq.${discordId}&select=id,nom,prenom,matricule&limit=1`);
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

      // Slash command /plainte
      if (interaction.type === 2 && interaction.data.name === "plainte") {
        return json({
          type: 9,
          data: {
            custom_id: "plainte_modal",
            title: "Dépôt de plainte",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "plaignant_identite", label: "Plaignant — Nom & Prénom", style: 1, required: true, placeholder: "Ex : Morrison James", min_length: 2, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "plaignant_tel", label: "Téléphone du plaignant", style: 1, required: true, placeholder: "Ex : 555-0198", min_length: 3, max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "plaignant_ddn", label: "Date de naissance du plaignant", style: 1, required: true, placeholder: "Ex : 01/01/1990", min_length: 8, max_length: 20 }] },
              { type: 1, components: [{ type: 4, custom_id: "individu", label: "Individu signalé (Nom, Prénom, Tél...)", style: 2, required: false, placeholder: "Nom, Prénom, Téléphone, signalement, apparence...", max_length: 1000 }] },
              { type: 1, components: [{ type: 4, custom_id: "raison", label: "Raison de la plainte", style: 2, required: true, placeholder: "Décrivez les faits et la raison de la plainte...", min_length: 10, max_length: 4000 }] }
            ]
          }
        });
      }

      // Modal submit plainte (nouvelle)
      if (interaction.type === 5 && interaction.data.custom_id === "plainte_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const plaignantIdentite = getValue("plaignant_identite");
        const plaignantTel      = getValue("plaignant_tel");
        const plaignantDdn      = getValue("plaignant_ddn");
        const individu          = getValue("individu");
        const raison            = getValue("raison");
        const now = new Date();
        const dateStr  = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const heureStr = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        const userId   = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} — \`${agent.matricule}\``;
        } catch {}
        const fields = [
          { name: "📅 Date & Heure", value: `${dateStr} à ${heureStr}`, inline: true },
          { name: "👮 Agent visé", value: agentDisplay, inline: true },
          { name: "🙋 Plaignant", value: plaignantIdentite, inline: true },
          { name: "📞 Téléphone", value: plaignantTel, inline: true },
          { name: "🎂 Date de naissance", value: plaignantDdn, inline: true },
          { name: "📋 Raison de la plainte", value: raison, inline: false }
        ];
        if (individu) fields.push({ name: "🎯 Individu signalé", value: individu, inline: false });
        await fetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{ title: "📋 Nouvelle plainte — SASP", color: 0xc0392b, fields, footer: { text: "SASP • Service des plaintes" }, timestamp: now.toISOString() }],
            components: [{ type: 1, components: [{ type: 2, style: 2, label: "Modifier", emoji: { name: "✏️" }, custom_id: `edit_plainte|${userId}` }] }]
          })
        });
        return json({ type: 4, data: { content: "✅ Plainte enregistrée et transmise.", flags: 64 } });
      }

      // Modal submit plainte (modification)
      if (interaction.type === 5 && interaction.data.custom_id.startsWith("edit_plainte_modal|")) {
        const parts = interaction.data.custom_id.split("|");
        const channelId  = parts[1];
        const messageId  = parts[2];
        const creatorId  = parts[3];
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const plaignantIdentite = getValue("plaignant_identite");
        const plaignantTel      = getValue("plaignant_tel");
        const plaignantDdn      = getValue("plaignant_ddn");
        const individu          = getValue("individu");
        const raison            = getValue("raison");
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${creatorId}>`;
        try {
          const agent = await getAgentByDiscordId(env, creatorId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} — \`${agent.matricule}\``;
        } catch {}
        // Récupère la date originale depuis le message existant
        const origRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const origMsg = await origRes.json();
        const origDateField = origMsg.embeds?.[0]?.fields?.find(f => f.name.includes("Date"));
        const dateValue = origDateField?.value || new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        const fields = [
          { name: "📅 Date & Heure", value: dateValue, inline: true },
          { name: "👮 Agent visé", value: agentDisplay, inline: true },
          { name: "🙋 Plaignant", value: plaignantIdentite, inline: true },
          { name: "📞 Téléphone", value: plaignantTel, inline: true },
          { name: "🎂 Date de naissance", value: plaignantDdn, inline: true },
          { name: "📋 Raison de la plainte", value: raison, inline: false }
        ];
        if (individu) fields.push({ name: "🎯 Individu signalé", value: individu, inline: false });
        const editedById = interaction.member?.user?.id || interaction.user?.id;
        let editorDisplay = "inconnu";
        try {
          const editor = await getAgentByDiscordId(env, editedById);
          if (editor) editorDisplay = `${editor.prenom} ${editor.nom} (${editor.matricule})`;
        } catch {}
        await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
          method: "PATCH",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{ title: "📋 Plainte — SASP", color: 0xe67e22, fields, footer: { text: `SASP • Modifiée par ${editorDisplay}` }, timestamp: new Date().toISOString() }],
            components: [{ type: 1, components: [{ type: 2, style: 2, label: "Modifier", emoji: { name: "✏️" }, custom_id: `edit_plainte|${creatorId}` }] }]
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
          const fields = interaction.message.embeds?.[0]?.fields || [];
          const getField = (kw) => fields.find(f => f.name.includes(kw))?.value || "";
          const channelId = interaction.channel_id;
          const messageId = interaction.message.id;
          return json({
            type: 9,
            data: {
              custom_id: `edit_plainte_modal|${channelId}|${messageId}|${creatorId}`,
              title: "Modifier la plainte",
              components: [
                { type: 1, components: [{ type: 4, custom_id: "plaignant_identite", label: "Plaignant — Nom & Prénom", style: 1, required: true, value: getField("Plaignant"), min_length: 2, max_length: 80 }] },
                { type: 1, components: [{ type: 4, custom_id: "plaignant_tel", label: "Téléphone du plaignant", style: 1, required: true, value: getField("Téléphone"), min_length: 3, max_length: 30 }] },
                { type: 1, components: [{ type: 4, custom_id: "plaignant_ddn", label: "Date de naissance du plaignant", style: 1, required: true, value: getField("naissance"), min_length: 8, max_length: 20 }] },
                { type: 1, components: [{ type: 4, custom_id: "individu", label: "Individu signalé", style: 2, required: false, value: getField("Individu"), max_length: 1000 }] },
                { type: 1, components: [{ type: 4, custom_id: "raison", label: "Raison de la plainte", style: 2, required: true, value: getField("Raison"), min_length: 10, max_length: 4000 }] }
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

    return json({ error: "Not found" }, 404);
  }
};
