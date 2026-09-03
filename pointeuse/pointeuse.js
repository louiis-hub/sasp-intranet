// Pointeuse Discord - module autonome
//
// Extrait verbatim de worker.js (SASP SUD), le 2026-09-03.
// 58 fonctions. Rien n'a ete reecrit : ce qui suit est
// exactement ce qui tourne en service.
//
// Ce qu'il faut fournir autour, et rien d'autre :
//   env.DISCORD_BOT_TOKEN, env.DISCORD_APPLICATION_ID
//   env.POINTEUSE_CHANNEL_ID, env.POINTEUSE_MESSAGE_ID
//   env.POINTEUSE_CLAIM_CHANNEL_ID
//   une base joignable par sbForSite() - voir la section APPUI
//   deux tables : pointages et pointeuse_corrections (voir schema.sql)
//
// Le detail du montage est dans pointeuse.md.

/* ============================================================
   REGLAGES
   Les cinq premiers decident du comportement anti-oubli. Ce sont
   les seules valeurs a ajuster pour un autre serveur.
   ============================================================ */

const SERVICE_CONFIRM_AFTER_MS = 5 * 60 * 60 * 1000;
const SERVICE_CONFIRM_REPEAT_MS = 2 * 60 * 60 * 1000;
const SERVICE_CONFIRM_GRACE_MS = 15 * 60 * 1000;
const SERVICE_FIRST_MISSED_PENALTY_MS = 4 * 60 * 60 * 1000;
const SERVICE_CONFIRMED_END_PENALTY_MS = 1 * 60 * 60 * 1000;
const CLAIM_WINDOW_MS = 48 * 60 * 60 * 1000;
const DISCORD_API = "https://discord.com/api/v10";


/* ============================================================
   APPUI
   Ce que la pointeuse appelle sans en faire partie. A remplacer
   par vos equivalents si vous avez deja les votres.
   ============================================================ */

function repairMojibakeString(value) {
  if (typeof value !== "string" || !/[ÃÂâð]/.test(value)) return value;
  let fixed = value;
  for (const [bad, good] of MOJIBAKE_REPLACEMENTS) fixed = fixed.split(bad).join(good);
  return fixed;
}

function repairDiscordTextDeep(value) {
  if (typeof value === "string") return repairMojibakeString(value);
  if (Array.isArray(value)) return value.map(repairDiscordTextDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = repairDiscordTextDeep(item);
    return out;
  }
  return value;
}

async function discordFetch(url, init = {}) {
  const next = { ...init };
  if (typeof next.body === "string" && /[ÃÂâð]/.test(next.body)) {
    try {
      next.body = JSON.stringify(repairDiscordTextDeep(JSON.parse(next.body)));
    } catch {
      next.body = repairMojibakeString(next.body);
    }
  }
  return fetch(url, next);
}

async function sendUserDM(env, userId, payload) {
  if (!userId) return { ok: false, error: "missing_user_id" };
  const dmRes = await discordFetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ recipient_id: String(userId) })
  });
  if (!dmRes.ok) return { ok: false, error: `dm_channel_${dmRes.status}`, details: await dmRes.text() };
  const channel = await dmRes.json();
  const msgRes = await discordFetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(Object.assign({ allowed_mentions: { parse: [] } }, payload))
  });
  if (!msgRes.ok) return { ok: false, error: `dm_message_${msgRes.status}`, details: await msgRes.text() };
  const message = await msgRes.json().catch(() => ({}));
  return { ok: true, channel_id: channel.id, message_id: message.id };
}

function getParisClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(repairDiscordTextDeep(data)), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-log-token",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS"
    }
  });
}

// Le secret DISCORD_GUILD_ID est optionnel. Une valeur non vide mais invalide
// (espace, retour a la ligne, identifiant errone) traversait le "||" des appels
// et faisait echouer toutes les requetes Discord, authentification comprise.
// On ne la retient donc que si elle a la forme d'un identifiant Discord.
function envGuildId(env) {
  const raw = String(env.DISCORD_GUILD_ID || "").trim();
  return /^\d{17,20}$/.test(raw) ? raw : SUD_SITE_GUILD_ID;
}

async function sb(env, method, path, body) {
  return sbForSite(env, method, path, body, "sud");
}

async function sbForSite(env, method, path, body, siteKey = "sud") {
  // Le SUD peut vivre en local ; le NORD reste chez Supabase.
  if (siteKey !== "nord" && (env.BASE || "") === "sqlite") {
    const db = await baseLocale();
    const prefer = method === "POST"
      ? (path.includes("on_conflict") ? "resolution=merge-duplicates,return=representation" : "return=representation")
      : "return=minimal";
    return SQLITE_EXEC(db, method, path, body, { prefer });
  }
  const cfg = getSupabaseConfigForSite(env, siteKey);
  const prefer = method === "POST"
    ? (path.includes("on_conflict") ? "resolution=merge-duplicates,return=representation" : "return=representation")
    : "return=minimal";
  const res = await fetch(`${cfg.url}/rest/v1${path}`, {
    method,
    headers: {
      "apikey": cfg.key,
      "Authorization": `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
      "Prefer": prefer
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

function getSupabaseConfigForSite(env, siteKey) {
  if (siteKey === "nord") {
    const key = env.NORD_SUPABASE_SERVICE_KEY || env.SUPABASE_NORD_SERVICE_KEY;
    if (!key) throw new Error("Clé Supabase Nord manquante dans Cloudflare.");
    return { url: NORD_SUPABASE_URL, key };
  }
  return { url: SUPABASE_URL, key: env.SUPABASE_SERVICE_KEY };
}

function siteKeyFromGuildId(guildId) {
  return String(guildId || "") === NORD_SITE_GUILD_ID ? "nord" : "sud";
}

async function getAgentByDiscordId(env, discordId, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/agents?discord_id=eq.${discordId}&select=id,nom,prenom,matricule,discord_id,grade,iban&limit=1`, null, siteKey);
  return data && data.length > 0 ? data[0] : null;
}

async function getAgentByMatricule(env, matricule, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/agents?matricule=eq.${matricule}&select=id,nom,prenom,matricule,discord_id,iban&limit=1`, null, siteKey);
  return data && data.length > 0 ? data[0] : null;
}

function parseAgentIdentityFromDiscordName(name) {
  const raw = String(name || "");
  const bracketMatricule = raw.match(/\[(\d{1,5})\]/);
  const clean = raw
    .replace(/\[[^\]]+\]|\([^)]*\)/g, " ")
    .replace(/[|â€¢Â·_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const matriculeMatch = clean.match(/(?:^|\s)(?:#|mle\.?|mat\.?|matricule)?\s*(\d{1,5})(?=\s|$)/i);
  const matricule = bracketMatricule ? bracketMatricule[1] : (matriculeMatch ? matriculeMatch[1] : "");
  const withoutMatricule = matriculeMatch
    ? (clean.slice(0, matriculeMatch.index) + " " + clean.slice(matriculeMatch.index + matriculeMatch[0].length)).replace(/\s+/g, " ").trim()
    : clean;
  const parts = withoutMatricule.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return {
    prenom: parts[0] || "",
    nom: parts.slice(1).join(" ") || "",
    matricule
  };
}

function sameAgentIdentity(pointage, agent) {
  const a = pointage?.agents || {};
  const agentDiscord = String(agent?.discord_id || "").trim();
  const rowDiscord = String(a.discord_id || "").trim();
  const agentMatricule = String(agent?.matricule || "").trim();
  const rowMatricule = String(a.matricule || "").trim();
  const agentName = `${agent?.prenom || ""} ${agent?.nom || ""}`.trim().toLowerCase();
  const rowName = `${a.prenom || ""} ${a.nom || ""}`.trim().toLowerCase();

  return String(pointage?.agent_id || "") === String(agent?.id || "")
    || (agentDiscord && rowDiscord && agentDiscord === rowDiscord)
    || (agentMatricule && rowMatricule && agentMatricule === rowMatricule)
    || (agentName && rowName && agentName === rowName);
}

function agentDisplayName(agent) {
  return `${agent?.prenom || ""} ${agent?.nom || ""}`.trim() || "Agent";
}

function addMsIso(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

function penalizedEndIso(pointage, actualEndIso, penaltyMs) {
  const startMs = new Date(pointage?.clock_in || actualEndIso).getTime();
  const endMs = new Date(actualEndIso).getTime();
  return new Date(Math.max(startMs, endMs - Math.max(0, penaltyMs || 0))).toISOString();
}

function claimStaffAllowed(interaction) {
  const roles = interaction?.member?.roles || [];
  return ADMIN_ROLE_IDS.some(r => roles.includes(r));
}

function weekInfoFromIso(iso) {
  const d = new Date(iso || Date.now());
  const monday = new Date(d);
  const dow = monday.getDay();
  monday.setDate(monday.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday.getTime() + 6 * 86400000);
  const key = monday.toISOString().slice(0, 10);
  const label = "Semaine du "
    + monday.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
    + " au "
    + sunday.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return { key, label };
}

function formatDurationFromMs(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

// La duree est acceptee sous les formes que les agents utilisent reellement :
// 1.5, 1,5, 1h30, 1:30, 4h, 90m. Le message d'origine affichant "1h39", refuser
// cette saisie n'avait aucun sens.
function parsePositiveHours(value) {
  const brut = String(value || "").trim().toLowerCase().replace(",", ".");
  if (!brut) return 0;
  let heures;
  const heuresMinutes = brut.match(/^(\d+)\s*[h:]\s*(\d{1,2})$/);
  const heuresSeules  = brut.match(/^(\d+(?:\.\d+)?)\s*h$/);
  const minutes       = brut.match(/^(\d+)\s*(?:m|min|mn)$/);
  if (heuresMinutes)     heures = Number(heuresMinutes[1]) + Number(heuresMinutes[2]) / 60;
  else if (heuresSeules) heures = Number(heuresSeules[1]);
  else if (minutes)      heures = Number(minutes[1]) / 60;
  else                   heures = Number(brut);
  if (!Number.isFinite(heures) || heures <= 0) return 0;
  return Math.min(Math.round(heures * 100) / 100, 24);
}

function modalValue(interaction, id) {
  return interaction.data?.components?.flatMap(r => r.components || [])?.find(c => c.custom_id === id)?.value?.trim() || "";
}

// â”€â”€ Discord message edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function editMessage(env, channelId, messageId, payload) {
  await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

async function updateInteractionOriginal(env, appId, token, content) {
  if (!appId || !token) return;
  await discordFetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, components: [] })
  });
}


/* ============================================================
   LA POINTEUSE
   ============================================================ */

async function getAgentForPointeuseInteraction(env, interaction, siteKey = "sud") {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const byDiscordId = await getAgentByDiscordId(env, userId, siteKey);
  if (byDiscordId) return byDiscordId;

  const member = interaction.member || {};
  const user = member.user || interaction.user || {};
  const displayName = member.nick || user.global_name || user.username || "";
  const parsed = parseAgentIdentityFromDiscordName(displayName);
  if (!parsed || !parsed.matricule) return null;

  const byMatricule = await getAgentByMatricule(env, parsed.matricule, siteKey);
  if (!byMatricule) return null;

  if (!byMatricule.discord_id || String(byMatricule.discord_id) !== String(userId)) {
    await sbForSite(env, "PATCH", `/agents?id=eq.${byMatricule.id}`, { discord_id: userId }, siteKey);
  }
  return { ...byMatricule, discord_id: userId };
}

async function getActivePointage(env, agentId, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/pointages?agent_id=eq.${agentId}&clock_out=is.null&order=clock_in.desc&limit=1`, null, siteKey);
  return data && data.length > 0 ? data[0] : null;
}

function pointageDurationSeconds(pointage, endIso) {
  const start = new Date(pointage?.clock_in || Date.now()).getTime();
  const end = new Date(endIso || Date.now()).getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}

function pointageClosePatch(pointage, endIso, reason = "manual") {
  return {
    clock_out: endIso,
    clockout_reason: reason,
    total_duration_seconds: pointageDurationSeconds(pointage, endIso)
  };
}

function pointageClosePatchForSite(pointage, endIso, siteKey = "sud", reason = "manual") {
  if (siteKey === "nord") return { clock_out: endIso };
  return pointageClosePatch(pointage, endIso, reason);
}

async function closePointage(env, pointage, siteKey = "sud", reason = "manual") {
  const now = new Date().toISOString();
  await sbForSite(env, "PATCH", `/pointages?id=eq.${pointage.id}`, pointageClosePatchForSite(pointage, now, siteKey, reason), siteKey);
  return { clock_out: now, duration_seconds: pointageDurationSeconds(pointage, now) };
}

async function closeActivePointagesForAgent(env, agentId, siteKey = "sud", reason = "manual") {
  const now = new Date().toISOString();
  const data = await sbForSite(env, "GET", `/pointages?agent_id=eq.${agentId}&clock_out=is.null&select=id,clock_in`, null, siteKey);
  const active = Array.isArray(data) ? data : [];
  if (!active.length) return { count: 0, clock_out: now };
  for (const p of active) {
    await sbForSite(env, "PATCH", `/pointages?id=eq.${p.id}`, pointageClosePatchForSite(p, now, siteKey, reason), siteKey);
  }
  return { count: active.length, clock_out: now };
}

async function getActivePointagesForAgentIdentity(env, agent, siteKey = "sud") {
  if (!agent) return [];
  const data = await sbForSite(env, "GET", `/pointages?clock_out=is.null&select=id,agent_id,clock_in,agents(id,nom,prenom,matricule,discord_id)&order=clock_in.asc`, null, siteKey);
  return (Array.isArray(data) ? data : []).filter(p => sameAgentIdentity(p, agent));
}

async function closeActivePointagesForAgentIdentity(env, agent, siteKey = "sud", reason = "manual") {
  const now = new Date().toISOString();
  const active = await getActivePointagesForAgentIdentity(env, agent, siteKey);
  if (!active.length) return { count: 0, clock_out: now };
  for (const p of active) {
    await sbForSite(env, "PATCH", `/pointages?id=eq.${p.id}`, pointageClosePatchForSite(p, now, siteKey, reason), siteKey);
  }
  return { count: active.length, clock_out: now };
}

async function refreshPointeuseMessage(env, channelId, messageId, siteKey = "sud") {
  if (!channelId || !messageId) return { ok: false, count: 0 };
  const allActive = await getAllActivePointages(env, siteKey);
  await editMessage(env, channelId, messageId, buildPointeuseMessage(allActive));
  return { ok: true, count: uniqueActivePointages(allActive).length };
}

async function handlePointeuseServiceButton(env, interaction, customId) {
  const siteKey = siteKeyFromGuildId(interaction.guild_id);
  const appId = env.DISCORD_APPLICATION_ID;
  const token = interaction.token;
  const channelId = interaction.channel_id || env.POINTEUSE_CHANNEL_ID;
  const messageId = interaction.message?.id || env.POINTEUSE_MESSAGE_ID;

  try {
    const agent = await getAgentForPointeuseInteraction(env, interaction, siteKey);
    if (!agent) {
      await updateInteractionOriginal(env, appId, token, "❌ Ton Discord ID n'est lié à aucun agent. Configure-le dans ton profil sur l'intranet.");
      return;
    }

    let content;
    if (customId === "prise_service") {
      const existing = await getActivePointagesForAgentIdentity(env, agent, siteKey);
      if (existing.length) {
        content = `⚠️ Tu es déjà en service, ${agent.prenom} !`;
      } else {
        const now = new Date().toISOString();
        const payload = siteKey === "nord"
          ? { agent_id: agent.id, clock_in: now }
          : {
              agent_id: agent.id,
              clock_in: now,
              discord_id: agent.discord_id || null,
              next_confirmation_at: addMsIso(now, SERVICE_CONFIRM_AFTER_MS),
              confirmation_count: 0
            };
        await sbForSite(env, "POST", "/pointages", payload, siteKey);
        content = `✅ Prise de service enregistrée, ${agent.prenom}.`;
      }
    } else {
      const active = await getActivePointagesForAgentIdentity(env, agent, siteKey);
      if (!active.length) {
        content = `⚠️ Tu n'es pas en service, ${agent.prenom} !`;
      } else {
        await closeActivePointagesForAgentIdentity(env, agent, siteKey);
        content = `✅ Fin de service enregistrée, ${agent.prenom}.`;
      }
    }

    await refreshPointeuseMessage(env, channelId, messageId, siteKey);
    await updateInteractionOriginal(env, appId, token, content);
  } catch (e) {
    await updateInteractionOriginal(env, appId, token, `❌ Erreur pointeuse : ${String(e.message || e).slice(0, 1500)}`);
  }
}

async function getAllActivePointages(env, siteKey = "sud") {
  const select = siteKey === "nord"
    ? "id,agent_id,clock_in,agents(nom,prenom,matricule,discord_id)"
    : "id,agent_id,clock_in,last_confirmation_at,confirmation_count,next_confirmation_at,confirmation_requested_at,discord_id,agents(nom,prenom,matricule,discord_id)";
  const data = await sbForSite(env, "GET", `/pointages?clock_out=is.null&select=${select}&order=clock_in.asc`, null, siteKey);
  return data || [];
}

function uniqueActivePointages(active) {
  const byAgent = new Map();
  for (const p of active || []) {
    const key = p.agent_id || p.id;
    if (!byAgent.has(key)) {
      byAgent.set(key, p);
      continue;
    }
    const current = byAgent.get(key);
    if (String(p.clock_in || "") < String(current.clock_in || "")) byAgent.set(key, p);
  }
  return Array.from(byAgent.values());
}

// â”€â”€ Message pointeuse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildPointeuseMessage(active) {
  const unique = uniqueActivePointages(active);
  const count = unique.length;
  const list = unique.map(p => {
    const a = p.agents || {};
    return `\u2022 ${(a.prenom + " " + a.nom).trim()} (${a.matricule || "\u2014"})`;
  }).join("\n");

  return {
    embeds: [{
      title: "\ud83d\ude94 SASP \u2014 Tableau de service",
      description: count > 0
        ? `**En service \u00b7 ${count} agent${count > 1 ? "s" : ""}**\n${list}`
        : "*Aucun agent en service*",
      color: count > 0 ? 0x3A9B4E : 0x3A4E64,
      footer: { text: "SASP \u00b7 Mis \u00e0 jour automatiquement" },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Prise de service", emoji: { name: "\ud83d\udfe2" }, custom_id: "prise_service" },
        { type: 2, style: 4, label: "Fin de service",   emoji: { name: "\ud83d\udd34" }, custom_id: "fin_service" },
        { type: 2, style: 2, label: "Retirer un agent", emoji: { name: "\ud83d\uded1" }, custom_id: "admin_remove" }
      ]
    }]
  };
}

// Neutralise le bouton de reclamation du message d'origine : une seule demande
// par service, et plus rien a cliquer une fois le delai passe.
async function disablePointeuseClaimButton(env, channelId, messageId, libelle) {
  if (!channelId || !messageId) return;
  try {
    const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (!res.ok) return;
    const message = await res.json();
    const rangees = (message.components || []).map(rangee => ({
      ...rangee,
      components: (rangee.components || []).map(bouton =>
        String(bouton.custom_id || "").startsWith("pointeuse_claim")
          ? { ...bouton, disabled: true, label: libelle || bouton.label }
          : bouton
      )
    }));
    await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ components: rangees })
    });
  } catch {}
}

function buildPointeuseConfirmationDm(pointage, siteKey) {
  return {
    embeds: [{
      title: "🚓 SASP — Pointeuse",
      description: "Vous êtes en service depuis bientôt 6 heures.\nÊtes-vous toujours en service ?",
      color: 0x3A9B4E,
      fields: [
        { name: "Prise de service", value: `<t:${Math.floor(new Date(pointage.clock_in).getTime() / 1000)}:f>`, inline: false },
        { name: "Délai de réponse", value: "15 minutes", inline: true }
      ],
      footer: { text: "SASP · Pointeuse" },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Oui, je suis toujours en service", emoji: { name: "🟢" }, custom_id: `pointeuse_confirm_yes|${siteKey}|${pointage.id}` },
        { type: 2, style: 4, label: "Non, terminer mon service", emoji: { name: "🔴" }, custom_id: `pointeuse_confirm_no|${siteKey}|${pointage.id}` },
        { type: 2, style: 1, label: "Réclamer des heures", emoji: { name: "⏱️" }, custom_id: `pointeuse_claim|${siteKey}|${pointage.id}` }
      ]
    }]
  };
}

function buildDisabledPointeuseConfirmationDm(title, description, color = 0x3A4E64) {
  return {
    embeds: [{
      title,
      description,
      color,
      footer: { text: "SASP · Pointeuse" },
      timestamp: new Date().toISOString()
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "Oui, je suis toujours en service", emoji: { name: "🟢" }, custom_id: "pointeuse_confirm_closed_yes", disabled: true },
        { type: 2, style: 4, label: "Non, terminer mon service", emoji: { name: "🔴" }, custom_id: "pointeuse_confirm_closed_no", disabled: true },
        { type: 2, style: 1, label: "Réclamer des heures", emoji: { name: "⏱️" }, custom_id: "pointeuse_claim_closed", disabled: true }
      ]
    }]
  };
}

async function getPointageById(env, pointageId, siteKey = "sud") {
  const rows = await sbForSite(
    env,
    "GET",
    `/pointages?id=eq.${encodeURIComponent(pointageId)}&select=id,agent_id,clock_in,clock_out,last_confirmation_at,confirmation_count,next_confirmation_at,confirmation_requested_at,confirmation_channel_id,confirmation_message_id,discord_id,agents(id,nom,prenom,matricule,discord_id)&limit=1`,
    null,
    siteKey
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function logPointeuseAutoClose(env, rows, title, color = 0xe67e22) {
  if (!rows.length) return;
  const lines = rows.map(p => {
    const a = p.agents || {};
    return `• **${`${a.prenom || ""} ${a.nom || ""}`.trim() || "Agent SASP"}** (${a.matricule || "—"})`;
  }).join("\n");
  await discordFetch(`${DISCORD_API}/channels/${POINTEUSE_LOG_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title,
        description: lines,
        color,
        footer: { text: "SASP · Pointeuse" },
        timestamp: new Date().toISOString()
      }]
    })
  }).catch(() => null);
}

async function sendPointeuseConfirmationRequest(env, pointage, siteKey = "sud") {
  const a = pointage.agents || {};
  const userId = pointage.discord_id || a.discord_id;
  const sent = await sendUserDM(env, userId, buildPointeuseConfirmationDm(pointage, siteKey));
  if (!sent.ok) throw new Error(sent.error || "dm_failed");
  const now = new Date().toISOString();
  await sbForSite(env, "PATCH", `/pointages?id=eq.${pointage.id}`, {
    confirmation_requested_at: now,
    confirmation_channel_id: sent.channel_id || null,
    confirmation_message_id: sent.message_id || null,
    discord_id: userId || null
  }, siteKey);
  return sent;
}

async function closePointageAfterNoConfirmation(env, pointage, siteKey = "sud") {
  const actualClosedAt = new Date().toISOString();
  const alreadyConfirmed = Number(pointage.confirmation_count || 0) > 0;
  const penaltyMs = alreadyConfirmed ? SERVICE_CONFIRMED_END_PENALTY_MS : SERVICE_FIRST_MISSED_PENALTY_MS;
  const effectiveClosedAt = siteKey === "nord" ? actualClosedAt : penalizedEndIso(pointage, actualClosedAt, penaltyMs);
  await sbForSite(env, "PATCH", `/pointages?id=eq.${pointage.id}`, pointageClosePatchForSite(pointage, effectiveClosedAt, siteKey, alreadyConfirmed ? "AUTO_CLOSED_MINUS_1H" : "AUTO_CLOSED_MINUS_4H"), siteKey);
  const closed = {
    clock_out: effectiveClosedAt,
    actual_clock_out: actualClosedAt,
    duration_seconds: pointageDurationSeconds(pointage, effectiveClosedAt),
    penalty_label: alreadyConfirmed ? "1h" : "4h"
  };
  const a = pointage.agents || {};
  const userId = pointage.discord_id || a.discord_id;
  const description = `Votre service a été automatiquement clôturé car aucune confirmation n'a été reçue.\n\nUne pénalité de **${closed.penalty_label}** a été appliquée sur votre temps de service.\n\nSi vous étiez toujours en service, vous pouvez envoyer une demande de récupération d'heures au Command Staff.`;
  if (pointage.confirmation_channel_id && pointage.confirmation_message_id) {
    await editMessage(env, pointage.confirmation_channel_id, pointage.confirmation_message_id, buildDisabledPointeuseConfirmationDm(
      "⚠️ SASP — Fin de service automatique",
      description,
      0xe67e22
    )).catch(() => null);
  }
  await sendUserDM(env, userId, {
    embeds: [{
      title: "⚠️ SASP — Fin de service automatique",
      description,
      color: 0xe67e22,
      fields: [
        { name: "Prise de service", value: `<t:${Math.floor(new Date(pointage.clock_in).getTime() / 1000)}:f>`, inline: false },
        { name: "Pénalité", value: closed.penalty_label, inline: true },
        { name: "Durée retenue", value: formatDurationFromMs(closed.duration_seconds * 1000), inline: true }
      ],
      footer: { text: "SASP · Pointeuse" },
      timestamp: closed.actual_clock_out
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 1, label: "Réclamer des heures", emoji: { name: "⏱️" }, custom_id: `pointeuse_claim|${siteKey}|${pointage.id}` }
      ]
    }]
  }).catch(() => null);
}

async function processPointeuseConfirmations(env, siteKey = "sud") {
  const nowMs = Date.now();
  const active = await sbForSite(
    env,
    "GET",
    `/pointages?clock_out=is.null&select=id,agent_id,clock_in,last_confirmation_at,confirmation_count,next_confirmation_at,confirmation_requested_at,confirmation_channel_id,confirmation_message_id,discord_id,agents(id,nom,prenom,matricule,discord_id)&order=clock_in.asc`,
    null,
    siteKey
  );
  const rows = uniqueActivePointages(active || []);
  const autoClosed = [];
  let requested = 0;

  for (const p of rows) {
    const requestedAt = p.confirmation_requested_at ? new Date(p.confirmation_requested_at).getTime() : 0;
    if (requestedAt && nowMs >= requestedAt + SERVICE_CONFIRM_GRACE_MS) {
      await closePointageAfterNoConfirmation(env, p, siteKey);
      autoClosed.push(p);
      continue;
    }

    const dueMs = new Date(p.next_confirmation_at || addMsIso(p.clock_in, SERVICE_CONFIRM_AFTER_MS)).getTime();
    if (!requestedAt && Number.isFinite(dueMs) && nowMs >= dueMs) {
      try {
        await sendPointeuseConfirmationRequest(env, p, siteKey);
        requested += 1;
      } catch (err) {
        console.warn("pointeuse confirmation dm failed", p.id, err && err.message);
      }
    }
  }

  if (autoClosed.length) {
    await logPointeuseAutoClose(env, autoClosed, "⏱️ Fin de service automatique — aucune confirmation");
  }
  if ((autoClosed.length || requested) && env.POINTEUSE_CHANNEL_ID && env.POINTEUSE_MESSAGE_ID) {
    await refreshPointeuseMessage(env, env.POINTEUSE_CHANNEL_ID, env.POINTEUSE_MESSAGE_ID, siteKey).catch(() => null);
  }
  return { requested, auto_closed: autoClosed.length };
}

async function handlePointeuseConfirmationButton(env, interaction, customId) {
  const parts = customId.split("|");
  const action = parts[0] === "pointeuse_confirm_yes" ? "yes" : "no";
  const siteKey = parts[1] === "nord" ? "nord" : "sud";
  const pointageId = parts[2];
  const pointage = await getPointageById(env, pointageId, siteKey);
  if (!pointage || pointage.clock_out) {
    if (interaction.channel_id && interaction.message?.id) {
      await editMessage(env, interaction.channel_id, interaction.message.id, buildDisabledPointeuseConfirmationDm(
        "🚓 SASP — Pointeuse",
        "Cette demande de confirmation n'est plus active.",
        0x3A4E64
      )).catch(() => null);
    }
    return;
  }

  const now = new Date().toISOString();
  if (action === "yes") {
    await sbForSite(env, "PATCH", `/pointages?id=eq.${pointage.id}`, {
      last_confirmation_at: now,
      confirmation_count: Number(pointage.confirmation_count || 0) + 1,
      confirmation_requested_at: null,
      confirmation_channel_id: null,
      confirmation_message_id: null,
      next_confirmation_at: addMsIso(now, SERVICE_CONFIRM_REPEAT_MS)
    }, siteKey);
    if (interaction.channel_id && interaction.message?.id) {
      await editMessage(env, interaction.channel_id, interaction.message.id, buildDisabledPointeuseConfirmationDm(
        "✅ SASP — Service confirmé",
        "Votre service continue normalement. Une nouvelle confirmation pourra être demandée dans 2 heures.",
        0x2ecc71
      )).catch(() => null);
    }
    return;
  }

  const confirmedBefore = Number(pointage.confirmation_count || 0) > 0;
  const actualClosedAt = new Date().toISOString();
  const effectiveClosedAt = confirmedBefore && siteKey !== "nord"
    ? penalizedEndIso(pointage, actualClosedAt, SERVICE_CONFIRMED_END_PENALTY_MS)
    : actualClosedAt;
  await sbForSite(env, "PATCH", `/pointages?id=eq.${pointage.id}`, pointageClosePatchForSite(pointage, effectiveClosedAt, siteKey, confirmedBefore ? "manual_minus_1h" : "manual"), siteKey);
  const closed = {
    clock_out: effectiveClosedAt,
    duration_seconds: pointageDurationSeconds(pointage, effectiveClosedAt),
    penalty_label: confirmedBefore ? "1h" : null
  };
  if (interaction.channel_id && interaction.message?.id) {
    await editMessage(env, interaction.channel_id, interaction.message.id, buildDisabledPointeuseConfirmationDm(
      "🔴 SASP — Fin de service enregistrée",
      `Votre service a été clôturé.${closed.penalty_label ? `\nPénalité appliquée : **${closed.penalty_label}**.` : ""}\nDurée retenue : **${formatDurationFromMs(closed.duration_seconds * 1000)}**.`,
      0xe74c3c
    )).catch(() => null);
  }
  if (env.POINTEUSE_CHANNEL_ID && env.POINTEUSE_MESSAGE_ID) {
    await refreshPointeuseMessage(env, env.POINTEUSE_CHANNEL_ID, env.POINTEUSE_MESSAGE_ID, siteKey).catch(() => null);
  }
}

function pointeuseClaimModal(customId) {
  return {
    type: 9,
    data: {
      title: "Réclamation d'heures",
      custom_id: customId,
      components: [
        { type: 1, components: [{ type: 4, custom_id: "claim_hours", label: "Nombre d'heures demandées", style: 1, required: true, placeholder: "1h30, 4h, 1.5 ou 90m", min_length: 1, max_length: 8 }] },
        { type: 1, components: [{ type: 4, custom_id: "claim_reason", label: "Raison de la demande", style: 2, required: true, placeholder: "Explique ce qui s'est passé avec la pointeuse.", min_length: 5, max_length: 1000 }] }
      ]
    }
  };
}

function staffClaimHoursModal(customId, defaultHours = "") {
  return {
    type: 9,
    data: {
      title: "Saisir les heures validées",
      custom_id: customId,
      components: [
        { type: 1, components: [{ type: 4, custom_id: "staff_hours", label: "Heures à créditer", style: 1, required: true, value: String(defaultHours || ""), placeholder: "1h30, 4h, 1.5 ou 90m", min_length: 1, max_length: 8 }] },
        { type: 1, components: [{ type: 4, custom_id: "staff_note", label: "Note staff", style: 2, required: false, placeholder: "Optionnel : raison de l'ajustement.", max_length: 500 }] }
      ]
    }
  };
}

async function sendPointeuseClaimToStaff(env, interaction, customId) {
  const [, siteToken, pointageId, messageId, channelId] = customId.split("|");
  const siteKey = siteToken === "nord" ? "nord" : "sud";
  const pointage = await getPointageById(env, pointageId, siteKey);
  const hours = parsePositiveHours(modalValue(interaction, "claim_hours"));
  const reason = modalValue(interaction, "claim_reason");
  if (!pointage) {
    return { type: 4, data: { content: "❌ Service introuvable : il a peut-être été supprimé.", flags: 64 } };
  }
  if (!hours) {
    return {
      type: 4,
      data: { content: "❌ Durée non comprise. Formats acceptés : `1.5`, `1h30`, `4h`, `90m`.", flags: 64 }
    };
  }
  const finDeService = pointage.clock_out ? new Date(pointage.clock_out).getTime() : 0;
  if (finDeService && Date.now() - finDeService > CLAIM_WINDOW_MS) {
    await disablePointeuseClaimButton(env, channelId, messageId, "Délai dépassé");
    return { type: 4, data: { content: "❌ Le délai de réclamation de 48h est dépassé.", flags: 64 } };
  }

  const a = pointage.agents || {};
  const requesterId = interaction.user?.id || pointage.discord_id || a.discord_id || "";
  const claimChannel = env.POINTEUSE_CLAIM_CHANNEL_ID || POINTEUSE_CLAIM_CHANNEL_ID;
  const claimId = `${siteKey}|${pointage.id}|${requesterId}|${String(hours).replace(".", "_")}`;
  const started = Math.floor(new Date(pointage.clock_in).getTime() / 1000);
  await discordFetch(`${DISCORD_API}/channels/${claimChannel}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `<@&1500975725153620033>`,
      allowed_mentions: { roles: ["1500975725153620033"] },
      embeds: [{
        title: "⏱️ Demande de récupération d'heures",
        color: 0xf1c40f,
        description: `${requesterId ? `<@${requesterId}>` : agentDisplayName(a)} demande **${hours}h** à créditer sur sa pointeuse.`,
        fields: [
          { name: "Agent", value: `${agentDisplayName(a)} (${a.matricule || "—"})`, inline: true },
          { name: "Site", value: siteKey.toUpperCase(), inline: true },
          { name: "Service commencé", value: `<t:${started}:f>`, inline: false },
          { name: "Raison", value: reason.slice(0, 1024), inline: false }
        ],
        footer: { text: "Command Staff · validation requise" },
        timestamp: new Date().toISOString()
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 3, label: `Valider ${hours}h`, emoji: { name: "✅" }, custom_id: `pointeuse_claim_accept|${claimId}`.slice(0, 100) },
          { type: 2, style: 1, label: "Saisir heures", emoji: { name: "✏️" }, custom_id: `pointeuse_claim_custom|${siteKey}|${pointage.id}|${requesterId}`.slice(0, 100) },
          { type: 2, style: 4, label: "Refuser", emoji: { name: "❌" }, custom_id: `pointeuse_claim_refuse|${siteKey}|${pointage.id}|${requesterId}`.slice(0, 100) }
        ]
      }]
    })
  });

  // Demande partie : le bouton n'a plus lieu d'etre sur ce service.
  await disablePointeuseClaimButton(env, channelId, messageId, "Demande envoyée");

  return {
    type: 4,
    data: { content: "✅ Ta demande a été envoyée au Command Staff.", flags: 64 }
  };
}

async function applyPointeuseClaimCorrection(env, interaction, { siteKey, pointageId, requesterId, hours, note = "" }) {
  if (!claimStaffAllowed(interaction)) {
    return { type: 4, data: { content: "❌ Command Staff uniquement.", flags: 64 } };
  }
  const pointage = await getPointageById(env, pointageId, siteKey);
  if (!pointage) return { type: 4, data: { content: "❌ Pointage introuvable.", flags: 64 } };
  const parsedHours = parsePositiveHours(hours);
  if (!parsedHours) return { type: 4, data: { content: "❌ Nombre d'heures invalide.", flags: 64 } };

  const a = pointage.agents || {};
  const week = weekInfoFromIso(pointage.clock_in);
  const minutesToAdd = Math.round(parsedHours * 60);
  const staffId = interaction.member?.user?.id || interaction.user?.id || "";
  const agentKey = a.id || pointage.agent_id || a.matricule || `${a.prenom || ""}${a.nom || ""}`;
  const existingRows = await sbForSite(env, "GET", `/pointeuse_corrections?semaine_key=eq.${encodeURIComponent(week.key)}&agent_id=eq.${encodeURIComponent(agentKey)}&select=*`, null, siteKey).catch(() => []);
  const existing = Array.isArray(existingRows) && existingRows.length ? existingRows[0] : null;
  const currentMinutes = parseInt(existing?.minutes_retires || 0, 10) || 0;
  const nextMinutes = currentMinutes - minutesToAdd;
  await sbForSite(env, "POST", "/pointeuse_corrections?on_conflict=semaine_key,agent_id", {
    semaine_key: week.key,
    semaine_label: week.label,
    agent_id: String(agentKey),
    agent_matricule: a.matricule || "",
    agent_nom: agentDisplayName(a),
    minutes_retires: nextMinutes,
    updated_by: staffId ? `<@${staffId}>` : "Command Staff",
    updated_at: new Date().toISOString()
  }, siteKey);

  if (interaction.channel_id && interaction.message?.id) {
    const oldEmbed = interaction.message.embeds?.[0] || {};
    await editMessage(env, interaction.channel_id, interaction.message.id, {
      content: "",
      embeds: [{
        title: "✅ Les big boss ont validé",
        color: 0x2ecc71,
        description: `${requesterId ? `<@${requesterId}>` : agentDisplayName(a)} récupère **${parsedHours}h** sur sa pointeuse.\nLe Command Staff a tranché — on n'est pas des rats ici. 🐀❌`,
        fields: [
          ...(oldEmbed.fields || []).slice(0, 4),
          { name: "Validé par", value: staffId ? `<@${staffId}>` : "Command Staff", inline: true },
          { name: "Correction appliquée", value: `+${parsedHours}h (${minutesToAdd} min)`, inline: true },
          ...(note ? [{ name: "Note", value: String(note).slice(0, 1024), inline: false }] : [])
        ],
        footer: { text: "SASP · Pointeuse" },
        timestamp: new Date().toISOString()
      }],
      components: []
    }).catch(() => null);
  }

  if (requesterId) {
    await sendUserDM(env, requesterId, {
      embeds: [{
        title: "✅ Les big boss ont validé",
        description: `Le Command Staff te crédite **${parsedHours}h**.\nOn n'est pas des rats ici. 🫡`,
        color: 0x2ecc71,
        footer: { text: "SASP · Pointeuse" },
        timestamp: new Date().toISOString()
      }]
    }).catch(() => null);
  }
  return { type: 4, data: { content: `✅ ${parsedHours}h créditée(s).`, flags: 64 } };
}

async function refusePointeuseClaim(env, interaction, customId) {
  if (!claimStaffAllowed(interaction)) return { type: 4, data: { content: "❌ Command Staff uniquement.", flags: 64 } };
  const [, siteKey, pointageId, requesterId = ""] = customId.split("|");
  const pointage = await getPointageById(env, pointageId, siteKey === "nord" ? "nord" : "sud").catch(() => null);
  const a = pointage?.agents || {};
  const staffId = interaction.member?.user?.id || interaction.user?.id || "";
  if (interaction.channel_id && interaction.message?.id) {
    await editMessage(env, interaction.channel_id, interaction.message.id, {
      content: "",
      embeds: [{
        title: "❌ Les big boss ont dit non",
        description: `${requesterId ? `<@${requesterId}>` : agentDisplayName(a)} — refusée par ${staffId ? `<@${staffId}>` : "Command Staff"}. Ça passe pas cette fois. 🚫`,
        color: 0xe74c3c,
        footer: { text: "SASP · Pointeuse" },
        timestamp: new Date().toISOString()
      }],
      components: []
    }).catch(() => null);
  }
  if (requesterId) {
    await sendUserDM(env, requesterId, {
      embeds: [{
        title: "❌ Les big boss ont dit non",
        description: "Le Command Staff a refusé ta demande de récupération d'heures. Ça passe pas cette fois. 🚫",
        color: 0xe74c3c,
        footer: { text: "SASP · Pointeuse" },
        timestamp: new Date().toISOString()
      }]
    }).catch(() => null);
  }
  return { type: 4, data: { content: "Demande refusée.", flags: 64 } };
}

async function testPointeuseConfirmationForUser(env, userId, siteKey = "sud") {
  const agent = await getAgentByDiscordId(env, userId, siteKey);
  if (!agent) return { ok: false, error: "agent_not_found" };
  const active = await getActivePointagesForAgentIdentity(env, agent, siteKey);
  const pointage = uniqueActivePointages(active)[0];
  if (!pointage) return { ok: false, error: "agent_not_in_service", agent };
  const enriched = await getPointageById(env, pointage.id, siteKey) || { ...pointage, agents: agent };
  const sent = await sendPointeuseConfirmationRequest(env, enriched, siteKey);
  return {
    ok: sent.ok,
    agent: {
      id: agent.id,
      matricule: agent.matricule,
      nom: agent.nom,
      prenom: agent.prenom,
      discord_id: agent.discord_id
    },
    pointage_id: pointage.id,
    dm_channel_id: sent.channel_id || null,
    dm_message_id: sent.message_id || null,
    error: sent.error || null
  };
}

function isPointeuseBoardMessage(message) {
  const title = message?.embeds?.[0]?.title || "";
  const componentIds = (message?.components || [])
    .flatMap(row => row.components || [])
    .map(component => component.custom_id)
    .filter(Boolean);
  return title.includes("Tableau de service")
    || componentIds.includes("prise_service")
    || componentIds.includes("fin_service")
    || componentIds.includes("admin_remove");
}

async function refreshPointeuseChannelBoards(env, channelId, siteKey = "sud", limit = 50) {
  if (!channelId) return { ok: false, error: "missing_channel_id", updated: 0, count: 0 };
  const active = await getAllActivePointages(env, siteKey);
  const payload = buildPointeuseMessage(active);
  const maxScan = Math.max(1, Math.min(Number(limit) || 50, 1000));
  const messages = [];
  let before = "";
  while (messages.length < maxScan) {
    const pageLimit = Math.min(100, maxScan - messages.length);
    const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${pageLimit}${before ? `&before=${before}` : ""}`, {
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (!res.ok) return { ok: false, error: `messages_${res.status}`, details: await res.text(), updated: 0, count: uniqueActivePointages(active).length };
    const page = await res.json();
    if (!Array.isArray(page) || !page.length) break;
    messages.push(...page);
    before = page[page.length - 1].id;
    if (page.length < pageLimit) break;
  }
  const pinsRes = await discordFetch(`${DISCORD_API}/channels/${channelId}/pins`, {
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
  }).catch(() => null);
  if (pinsRes && pinsRes.ok) {
    const pins = await pinsRes.json().catch(() => []);
    if (Array.isArray(pins)) messages.push(...pins);
  }
  const byId = new Map();
  for (const message of messages) if (message?.id) byId.set(message.id, message);
  const boards = Array.from(byId.values()).filter(isPointeuseBoardMessage);
  for (const message of boards) {
    await editMessage(env, channelId, message.id, payload).catch(() => null);
  }
  return { ok: true, scanned: byId.size, updated: boards.length, count: uniqueActivePointages(active).length };
}

// â”€â”€ Auto clock-out agents en service depuis +6h â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function autoClockout6h(env) {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const data = await sb(env, "GET", `/pointages?clock_out=is.null&select=id,agent_id,clock_in,agents(nom,prenom,matricule,discord_id)&order=clock_in.asc`);
  const active = data || [];
  const recentAgentIds = new Set(active.filter(p => String(p.clock_in || "") >= sixHoursAgo).map(p => p.agent_id));
  const expired = active.filter(p => String(p.clock_in || "") < sixHoursAgo);
  const staleDuplicates = expired.filter(p => recentAgentIds.has(p.agent_id));
  const realExpired = uniqueActivePointages(expired.filter(p => !recentAgentIds.has(p.agent_id)));
  for (const p of staleDuplicates) {
    await sb(env, "PATCH", `/pointages?id=eq.${p.id}`, { clock_out: new Date().toISOString() });
  }
  if (!realExpired.length) {
    if (staleDuplicates.length) {
      const remaining = await getAllActivePointages(env);
      const chId = env.POINTEUSE_CHANNEL_ID;
      const msgId = env.POINTEUSE_MESSAGE_ID;
      if (chId && msgId) await editMessage(env, chId, msgId, buildPointeuseMessage(remaining));
    }
    return 0;
  }
  const now = new Date().toISOString();
  for (const p of realExpired) {
    await closeActivePointagesForAgent(env, p.agent_id, "sud", "AUTO_CLOSED_LEGACY_6H");
    const a = p.agents || {};
    const displayName = `${a.prenom || ""} ${a.nom || ""}`.trim() || "Agent SASP";
    try {
      await sendUserDM(env, a.discord_id, {
        embeds: [{
          title: "\u23f1\ufe0f Fin de service automatique",
          description: `Bonjour **${displayName}**, ton service a \u00e9t\u00e9 termin\u00e9 automatiquement car tu as d\u00e9pass\u00e9 les **6 heures** sur la pointeuse.\n\nPense \u00e0 bien quitter ton service manuellement la prochaine fois.`,
          color: 0xe67e22,
          fields: [
            { name: "Matricule", value: String(a.matricule || "\u2014"), inline: true },
            { name: "D\u00e9connexion", value: "Automatique 6h", inline: true }
          ],
          footer: { text: "SASP \u00b7 Pointeuse" },
          timestamp: now
        }]
      });
    } catch (err) {
      console.warn("autoClockout6h dm failed", a.discord_id, err && err.message);
    }
  }
  const lines = realExpired.map(p => {
    const a = p.agents || {};
    return `\u2022 **${(a.prenom + ' ' + a.nom).trim()}** (${a.matricule || '\u2014'}) a oubli\u00e9 de terminer son service et a bien \u00e9t\u00e9 d\u00e9connect\u00e9 automatiquement.`;
  }).join('\n');
  await discordFetch(`${DISCORD_API}/channels/1519525957390827711/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: '\u23f1\ufe0f Fin de service automatique \u2014 6h d\u00e9pass\u00e9es',
        description: lines,
        color: 0xe67e22,
        footer: { text: 'SASP \u00b7 Auto clock-out 6h' },
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
  return realExpired.length;
}

// â”€â”€ Auto clock-out tous les agents actifs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function autoClockoutAll(env) {
  const active = await getAllActivePointages(env);
  if (!active.length) return 0;
  const activeUnique = uniqueActivePointages(active);
  const now = new Date().toISOString();
  for (const p of active) {
    await sb(env, "PATCH", `/pointages?id=eq.${p.id}`, pointageClosePatch(p, now, "AUTO_CLOSED_WEEKLY"));
  }
  const names = activeUnique.map(p => {
    const a = p.agents || {};
    return `\u2022 ${(a.prenom + ' ' + a.nom).trim()} (${a.matricule || '\u2014'})`;
  }).join('\n');
  await discordFetch(`${DISCORD_API}/channels/1519525957390827711/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: '\ud83d\udd57 Fin de service automatique \u2014 Dimanche 20h',
        description: `**${activeUnique.length} agent${activeUnique.length > 1 ? 's' : ''} d\u00e9connect\u00e9${activeUnique.length > 1 ? 's' : ''} automatiquement :**\n${names}`,
        color: 0xe74c3c,
        footer: { text: 'CENTRALE PA \u00b7 Auto clock-out hebdomadaire' },
        timestamp: now
      }]
    })
  });
  // Mise Ã  jour du message pointeuse Discord si env vars prÃ©sentes
  const chId = env.POINTEUSE_CHANNEL_ID;
  const msgId = env.POINTEUSE_MESSAGE_ID;
  if (chId && msgId) {
    await editMessage(env, chId, msgId, buildPointeuseMessage([]));
  }
  return activeUnique.length;
}
