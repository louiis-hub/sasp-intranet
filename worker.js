// SASP Intranet â€” Cloudflare Worker (auth + pointeuse Discord)
const DISCORD_API = "https://discord.com/api/v10";
const SUPABASE_URL = "https://ufxhxptzcnvelnbprwng.supabase.co";
const NORD_SUPABASE_URL = "https://zvyyqqeqqruzqrmbqkkh.supabase.co";

const MOJIBAKE_REPLACEMENTS = [
  ["Ã©", "\u00e9"], ["Ã¨", "\u00e8"], ["Ãª", "\u00ea"], ["Ã«", "\u00eb"],
  ["Ã ", "\u00e0"], ["Ã¢", "\u00e2"], ["Ã¤", "\u00e4"], ["Ã§", "\u00e7"],
  ["Ã®", "\u00ee"], ["Ã¯", "\u00ef"], ["Ã´", "\u00f4"], ["Ã¶", "\u00f6"],
  ["Ã¹", "\u00f9"], ["Ã»", "\u00fb"], ["Ã¼", "\u00fc"], ["Ã‰", "\u00c9"],
  ["Ã€", "\u00c0"], ["Ã‡", "\u00c7"], ["Â·", "\u00b7"], ["Â°", "\u00b0"],
  ["Â«", "\u00ab"], ["Â»", "\u00bb"], ["Â", ""],
  ["â€”", "\u2014"], ["â€“", "\u2013"], ["â€¢", "\u2022"], ["â€¦", "\u2026"],
  ["â€˜", "\u2018"], ["â€™", "\u2019"], ["â€œ", "\u201c"], ["â€", "\u201d"],
  ["âŒ", "\u274c"], ["âœ…", "\u2705"], ["âœï¸", "\u270f\ufe0f"],
  ["âš–ï¸", "\u2696\ufe0f"], ["âš ï¸", "\u26a0\ufe0f"], ["â³", "\u23f3"],
  ["â±ï¸", "\u23f1\ufe0f"], ["â„¹ï¸", "\u2139\ufe0f"],
  ["ðŸš”", "\ud83d\ude94"], ["ðŸŸ¢", "\ud83d\udfe2"], ["ðŸ”´", "\ud83d\udd34"],
  ["ðŸ›‘", "\ud83d\uded1"], ["ðŸ•—", "\ud83d\udd57"], ["ðŸ“‹", "\ud83d\udccb"],
  ["ðŸ’¸", "\ud83d\udcb8"], ["ðŸ‘¤", "\ud83d\udc64"], ["ðŸ†”", "\ud83c\udd94"],
  ["ðŸ’°", "\ud83d\udcb0"], ["ðŸ“¨", "\ud83d\udce8"], ["ðŸ”Ž", "\ud83d\udd0e"],
  ["ðŸ§‘", "\ud83e\uddd1"], ["ðŸ“ž", "\ud83d\udcde"], ["ðŸ‘®", "\ud83d\udc6e"],
  ["ðŸ•", "\ud83d\udd50"], ["ðŸ”—", "\ud83d\udd17"], ["ðŸ“", "\ud83d\udccd"],
  ["ðŸ“Œ", "\ud83d\udccc"], ["ðŸ·ï¸", "\ud83c\udff7\ufe0f"],
  ["ðŸ”’", "\ud83d\udd12"], ["ðŸ”„", "\ud83d\udd04"], ["ðŸš«", "\ud83d\udeab"],
  ["ðŸ“…", "\ud83d\udcc5"], ["ðŸ™‹", "\ud83d\ude4b"], ["ðŸŽ¯", "\ud83c\udfaf"],
  ["ðŸ“", "\ud83d\udcdd"]
];

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

const AUTO_REACTION_CHANNEL_ID = "1500994818543849723";
const AUTO_REACTION_EMOJI = "%E2%9C%85";
const CEREMONIE_REMINDER_CHANNEL_ID = "1500975725803606024";
const CEREMONIE_REMINDER_PLAN_URL = "https://louiis-hub.github.io/sasp-intranet/assets/ceremonie-salle.png";

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

async function sendCeremonieReminder(env, options = {}) {
  const clock = getParisClock();
  if (!options.force && (clock.weekday !== "Sun" || clock.hour !== "12" || clock.minute !== "03")) {
    return { ok: true, skipped: true, reason: "outside_paris_schedule", clock };
  }

  const channelId = options.channelId || env.CEREMONIE_CHANNEL_ID || env.CEREMONY_CHANNEL_ID || CEREMONIE_REMINDER_CHANNEL_ID;
  if (!channelId) return { ok: false, skipped: true, reason: "missing_ceremonie_channel_id" };

  const content = [
    "Mes respects, <@&1501250580058870104>",
    "",
    "**Cérémonie 21h00 - Salle de cérémonie**",
    "",
    "Vous pourrez retrouver les tenues de cérémonie en cliquant [ici](https://docs.google.com/spreadsheets/d/1-aR8sDaFU77PGchtUrkJyCaLJV8kOVki3702WJ_K58Q/edit?usp=sharing).",
    "",
    "Vous trouverez également le plan de la salle de cérémonie ci-dessous.",
    "",
    "**Aucune arme de service autorisée dans la salle, laissez-les dans vos casiers personnels.**",
    "",
    "*Toute absence doit être justifiée, toute absence injustifiée pourra être passible de sanctions disciplinaires.*",
    "",
    "Best regards,",
    "",
    "<:SASP:1505194044031242381> [99] Commandant",
    "San Andreas State Police",
    "",
    CEREMONIE_REMINDER_PLAN_URL
  ].join("\n");

  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { roles: ["1501250580058870104"] }
    })
  });

  if (!res.ok) {
    return { ok: false, status: res.status, body: await res.text().catch(() => "") };
  }
  const message = await res.json().catch(() => null);
  if (message?.id) {
    for (const emoji of ["%E2%9C%85", "%E2%9D%8C"]) {
      await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${message.id}/reactions/${emoji}/@me`, {
        method: "PUT",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
    }
  }
  return { ok: true, channel_id: channelId, message_id: message?.id || null };
}

async function reactToChannelMessages(env, channelId = AUTO_REACTION_CHANNEL_ID, limit = 20) {
  const messagesRes = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${Math.max(1, Math.min(Number(limit) || 50, 100))}`, {
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!messagesRes.ok) {
    const text = await messagesRes.text().catch(() => "");
    throw new Error(`messages ${messagesRes.status}: ${text.slice(0, 300)}`);
  }
  const messages = await messagesRes.json();
  let reacted = 0;
  let skipped = 0;
  let errors = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message?.id) continue;
    const alreadyReacted = (message.reactions || []).some(r => r?.emoji?.name === "✅" && r.me);
    if (alreadyReacted) { skipped++; continue; }
    const reactionRes = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${message.id}/reactions/${AUTO_REACTION_EMOJI}/@me`, {
      method: "PUT",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (reactionRes.ok || reactionRes.status === 204) reacted++;
    else errors++;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return { ok: true, channel_id: channelId, scanned: Array.isArray(messages) ? messages.length : 0, reacted, skipped, errors };
}

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
  'Chief':               '1519451362235256922',
  'Commandant':          '1500983026987962388',
  'Capitaine':           '1500975725153620036',
  'Lieutenant II':       '1500983449287131266',
  'Lieutenant I':        '1500975725153620034',
  'Sergeant II':         '1500982880950550752',
  'Sergeant I':          '1500975725153620032',
  'Senior Lead Trooper': '1500975725153620031',
  'Trooper III':         '1500975725153620030',
  'Trooper II':          '1500975724750704669',
  'Trooper I':           '1500975724750704668',
  'Rookie':              '1500975724750704667'
};
const ROLE_TO_GRADE = Object.fromEntries(Object.entries(GRADE_ROLES).map(([k,v]) => [v,k]));

const ALL_SYNCABLE_ROLES = { ...DIVISION_ROLES, ...PPA_ROLES, ...GRADE_ROLES };

const SUD_SITE_GUILD_ID = "1500975724750704661";
const NORD_SITE_GUILD_ID = "1516510943318642950";

const NORD_DIVISION_ROLES = {
  'PA': '1519012732886585526'
};
const NORD_PPA_ROLES = {};
const NORD_GRADE_ROLES = {
  'Commandant':          '1516510943453122565',
  'Capitaine':           '1516510943453122564',
  'Lieutenant II':       '1516510943453122563',
  'Lieutenant I':        '1516510943453122562',
  'Sergeant II':         '1516510943453122561',
  'Sergeant I':          '1517967063094788278',
  'Senior Lead Trooper': '1517967071667814640',
  'Trooper III':         '1517967073358118963',
  'Trooper II':          '1517967074042056926',
  'Trooper I':           '1517967075572842597',
  'Cadet':               '1517967074482323629'
};

const GRADE_SALAIRE = {
  'Chief':               1200,
  'Commandant':          1050,
  'Capitaine':           900,
  'Lieutenant II':       825,
  'Lieutenant I':        750,
  'Sergeant II':         675,
  'Sergeant I':          600,
  'Senior Lead Officer': 450,
  'Senior Lead Trooper': 450,
  'Trooper III':         375,
  'Trooper II':          300,
  'Trooper I':           225,
  'Rookie':              150,
  'Cadet':               150
};

function roleConfigForGuild(guildId) {
  if (String(guildId || "") === NORD_SITE_GUILD_ID) {
    return {
      divisions: NORD_DIVISION_ROLES,
      ppa: NORD_PPA_ROLES,
      grades: NORD_GRADE_ROLES
    };
  }
  return { divisions: DIVISION_ROLES, ppa: PPA_ROLES, grades: GRADE_ROLES };
}

function roleToDivisionForGuild(guildId) {
  const divisions = roleConfigForGuild(guildId).divisions;
  return Object.fromEntries(Object.entries(divisions).map(([k, v]) => [v, k]));
}

function gradeFromRolesForGuild(roles, guildId) {
  const grades = roleConfigForGuild(guildId).grades;
  const hit = Object.entries(grades).find(([, roleId]) => roles.includes(roleId));
  return hit ? hit[0] : null;
}

function countGradesFromRoleCountsForGuild(roleCounts, guildId) {
  const grades = roleConfigForGuild(guildId).grades;
  const counts = {};
  for (const [grade, roleId] of Object.entries(grades)) counts[grade] = roleCounts[roleId] || 0;
  return counts;
}

function syncableRolesForGuild(guildId) {
  const cfg = roleConfigForGuild(guildId);
  return { ...cfg.divisions, ...cfg.ppa, ...cfg.grades };
}

function parseAgentDisplayName(displayName) {
  const value = String(displayName || "").trim();
  const match = value.match(/^\s*\[?([A-Za-z0-9-]{1,12})\]?\s+(.+?)\s*$/);
  if (!match) return null;
  const fullName = match[2].replace(/\s+/g, " ").trim();
  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  return {
    matricule: match[1],
    prenom: parts[0],
    nom: parts.slice(1).join(" "),
    display_name: value
  };
}

function memberRoleInfo(member, guildId) {
  const roles = member.roles || [];
  const roleToDivision = roleToDivisionForGuild(guildId);
  const ppaRoles = roleConfigForGuild(guildId).ppa;
  return {
    divisions: roles.filter(r => roleToDivision[r]).map(r => roleToDivision[r]),
    ppa1: !!ppaRoles.ppa1 && roles.includes(ppaRoles.ppa1),
    ppa2: !!ppaRoles.ppa2 && roles.includes(ppaRoles.ppa2),
    ppa3: (!!ppaRoles.ppa3a && roles.includes(ppaRoles.ppa3a)) || (!!ppaRoles.ppa3b && roles.includes(ppaRoles.ppa3b)),
    grade: gradeFromRolesForGuild(roles, guildId)
  };
}

function gradeFromRoles(roles) {
  const hit = Object.entries(GRADE_ROLES).find(([, roleId]) => roles.includes(roleId));
  return hit ? hit[0] : null;
}

function countGradesFromRoleCounts(roleCounts) {
  const counts = {};
  for (const [grade, roleId] of Object.entries(GRADE_ROLES)) counts[grade] = roleCounts[roleId] || 0;
  return counts;
}

const STAFF_ROLE_IDS = [
  '1519507318188933140', // rôle gestionnaire
  '1500975725153620033', // Command Staff
  '1504451288065118248', // État Major
  '1504452141518032956', // Supervisor Team
  '1519171150884769873'  // Admin Division
];

const ADMIN_ROLE_IDS = [
  '1500975725153620033', // Command Staff
  '1504451288065118248', // Ã‰tat Major
  '1504452141518032956'  // Supervisor Team
];
const FTF_ROLE_ID = "1528370846908026951";
const FTF_NOTIFICATION_CHANNEL_ID = "1531372214434267297";
const FTF_CONVOCATION_CHANNEL_ID = "1531372214434267297";
const FTF_LOG_CHANNEL_ID = "1531372712314929265";
const SERVICE_HOUSING_PANEL_CHANNEL_ID = "1518674483060281454";
const SERVICE_HOUSING_CATEGORY_ID = "1501323835562000384";
const TICKET_DEFAULT_PANEL_CHANNEL_ID = "1521575058500489478";
const TICKET_DEFAULT_CATEGORY_ID = "1501323835562000384";
const TICKET_PANEL_IMAGE_URL = "https://louiis-hub.github.io/sasp-intranet/assets/ticket-panel-sasp.png";
const TICKET_PANEL_LOGO_URL = "https://louiis-hub.github.io/sasp-intranet/assets/sasp-sud-logo-def.png";
const TICKET_PANEL_ACCENT_COLOR = 0x0b2f4a;
const TICKET_FOOTER_TEXT = "SASP - San Andreas State Trooper";
const DEFCON_ALLOWED_ROLE_IDS = [
  "1500975725153620033",
  "1504452141518032956",
  "1519500254180020284"
];
const DEFCON_PING_ROLE_ID = "1500975724750704665";
const DEFCON_STATUS_CHANNEL_ID = "1533653868465094656";
const DEFCON_CHANNEL_NAMES = {
  "1": "🚥・𝖣𝖤𝖥𝖢𝖮𝖭-1",
  "2": "🚥・𝖣𝖤𝖥𝖢𝖮𝖭-2",
  "3": "🚥・𝖣𝖤𝖥𝖢𝖮𝖭-3",
  "4": "🚥・𝖣𝖤𝖥𝖢𝖮𝖭-4",
  "5": "🚥・𝖣𝖤𝖥𝖢𝖮𝖭-5"
};
const DEFCON_IMAGE_URLS = {
  "1": "https://louiis-hub.github.io/sasp-intranet/assets/defcon-1.jpg",
  "2": "https://louiis-hub.github.io/sasp-intranet/assets/defcon-2.jpg",
  "3": "https://louiis-hub.github.io/sasp-intranet/assets/defcon-3.jpg",
  "4": "https://louiis-hub.github.io/sasp-intranet/assets/defcon-4.jpg",
  "5": "https://louiis-hub.github.io/sasp-intranet/assets/defcon-5.jpg"
};
const DEFCON_COLORS = {
  "1": 0xb91c1c,
  "2": 0xea580c,
  "3": 0xf59e0b,
  "4": 0x84cc16,
  "5": 0x22c55e
};
const TICKET_OPTIONS = [
  { key: "etat-major", emoji: "\ud83d\udc51", label: "Etat-Major", roleIds: ["1500975725153620033", "1504452141518032956"], categoryId: "1501323835562000384" },
  { key: "police-academy", emoji: "\ud83c\udf93", label: "Police Academy", roleIds: ["1518632035911205168", "1518631032167993534", "1504452141518032956"], categoryId: "1518633398753562794" },
  { key: "cnu", emoji: "\ud83e\udd1d", label: "Crisis Negotiation Unit", roleIds: ["1504452141518032956", "1519495585487388773", "1519495618060619877"], categoryId: "1519498275974025226" },
  { key: "traffic-unit", emoji: "\ud83d\udea6", label: "Traffic Unit", roleIds: ["1504452141518032956", "1501522839717679185", "1501525042037788772"], categoryId: "1519498407503466616" },
  { key: "cid", emoji: "\ud83d\udd75\ufe0f", label: "Criminal Investigation Division", roleIds: ["1504452141518032956", "1501526499910746132"], categoryId: "1528370627185082482" },
  { key: "swat", emoji: "\u2694\ufe0f", label: "Special Weapons And Tactics", roleIds: ["1504452141518032956", "1504450026393309276"], categoryId: "1528370732323704833" },
  { key: "ftf", emoji: "\ud83c\udfaf", label: "Fugitive Task Force", roleIds: ["1504452141518032956", "1528370954319822949"], categoryId: "1528371149095043204" },
  { key: "syndicat", emoji: "\ud83e\udd1d", label: "Syndicat", roleIds: ["1504452141518032956", "1519496676539109486"], categoryId: "1528371218422562836" },
  { key: "k9", emoji: "\ud83d\udc15", label: "K9 Unit", roleIds: ["1504452141518032956", "1535392140140748820", "1535392215889870869"], categoryId: "1535392569721094285" },
  { key: "affaires-internes", emoji: "\ud83d\udd12", label: "Affaires Internes", roleIds: ["1504452141518032956", "1524117754725007422"], categoryId: "1528371395174727751", unavailable: true, description: "Pas disponible" }
];
const TICKET_ACADEMY_PANEL_OPTIONS = [
  { key: "etat-major", emoji: "\ud83c\udfdb\ufe0f", label: "Etat-Major", roleIds: ["1500975725153620033", "1504452141518032956"], categoryId: "1501323835562000384", description: "Demande officielle ou administrative" },
  { key: "police-academy-rc", emoji: "\ud83c\udf93", label: "Police Academy", roleIds: ["1518632035911205168", "1518631032167993534", "1504452141518032956"], categoryId: "1518633398753562794", channelPrefix: "rc", description: "Recrutement, formations ou candidatures" }
];
const TICKET_EM_SUPERVISOR_ROLE_ID = "1504452141518032956";
const TICKET_POLICE_ACADEMY_ACCESS_ROLE_ID = "1518631032167993534";
const PLAINTESASP_DEFAULT_CHANNEL_ID = "1538289329917534328";

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ENTERPRISE_GUILD_ID = "1523759012623941746";
const ENTERPRISE_ADMIN_ROLE_ID = "1523759223761010858";
const ENTERPRISES = [
  "Burgershot (Sandy)",
  "Hornys",
  "Pizzathis",
  "Rex's Dinner",
  "LiquorBar (Sandy)",
  "Bahamas",
  "Kebab Amir",
  "Unicorn",
  "Restaurant Triade",
  "Avocat",
  "PawnShop",
  "Logistic (grossiste mati\u00e8res premi\u00e8res)",
  "Taxi",
  "Casino",
  "Ammunation",
  "Agence Immobili\u00e8re",
  "Weazel News",
  "Tabac",
  "Vignerons",
  "Brasserie",
  "Benny's",
  "Tuner Shop",
  "Garage GM Motor",
  "SASP-SUD",
  "SASP-NORD",
  "Gouvernement",
  "D.O.J",
  "SAMS"
];
const ENTERPRISE_COLORS = [
  0xe74c3c, 0xe67e22, 0xf1c40f, 0x2ecc71, 0x1abc9c, 0x3498db, 0x9b59b6,
  0xfd79a8, 0x00cec9, 0x6c5ce7, 0x55efc4, 0xff7675, 0x74b9ff, 0xa29bfe,
  0xffb142, 0x33d9b2, 0x34ace0, 0x706fd3, 0xb33939, 0x218c74, 0x227093,
  0x40407a, 0xcc8e35, 0x84817a, 0x3c6382, 0x0a3d62, 0x78e08f, 0xfa983a
];
const ENTERPRISE_EMOJIS = [
  "\ud83c\udf54", "\ud83c\udf57", "\ud83c\udf55", "\ud83c\udf7d\ufe0f", "\ud83c\udf7a",
  "\ud83c\udf79", "\ud83c\udf2f", "\ud83e\udd84", "\ud83e\udd62", "\u2696\ufe0f",
  "\ud83d\udc8e", "\ud83d\udce6", "\ud83d\ude95", "\ud83c\udfb0", "\ud83d\udd2b",
  "\ud83c\udfe0", "\ud83d\udcf0", "\ud83d\udeac", "\ud83c\udf77", "\ud83c\udf7b",
  "\ud83d\udd27", "\ud83c\udfce\ufe0f", "\ud83d\ude97", "\ud83c\udfdb\ufe0f", "\ud83d\ude93",
  "\ud83c\udfdb\ufe0f", "\u2696\ufe0f", "\ud83d\ude91"
];

function enterpriseCategoryName(enterprise, index) {
  return `${ENTERPRISE_EMOJIS[index % ENTERPRISE_EMOJIS.length]}\u30fb${enterprise}`;
}
function enterpriseRoleName(baseName, index) {
  return `${ENTERPRISE_EMOJIS[index % ENTERPRISE_EMOJIS.length]}\u30fb${baseName}`;
}
const ENTERPRISE_GENERAL_CATEGORY = "\ud83c\udf10\u30fbG\u00e9n\u00e9ral";
const ENTERPRISE_GENERAL_CHANNELS = ["arriver", "depart", "demande-de-role", "discussion", "ticket"];
const ENTERPRISE_GENERAL_CHANNEL_LABELS = [
  { legacy: ["arriver"], name: "\ud83d\udeecarriver" },
  { legacy: ["depart"], name: "\ud83d\udeebdepart" },
  { legacy: ["demande-de-role"], name: "\ud83e\udeaademande-de-role" },
  { legacy: ["discussion"], name: "\ud83d\udde8\ufe0fdiscussion" },
  { legacy: ["ticket"], name: "\ud83c\udfabticket" }
];
const ENTERPRISE_CITIZEN_ROLE = "Citoyen";
const PUBLIC_SERVICE_ENTERPRISES = ["SASP-SUD", "SASP-NORD", "Gouvernement", "D.O.J", "SAMS"];
const PUBLIC_SERVICE_CHANNELS = ["annonce", "discussion"];

function isEnterpriseCategoryName(name) {
  return ENTERPRISES.some(enterprise =>
    name === enterprise ||
    name.endsWith(` ${enterprise}`) ||
    name.endsWith(`\u30fb${enterprise}`) ||
    name.endsWith(`ãƒ»${enterprise}`)
  );
}

function isPublicServiceEnterprise(enterprise) {
  return PUBLIC_SERVICE_ENTERPRISES.includes(enterprise);
}

function enterpriseRoleSpecs(enterprise) {
  if (enterprise === "SASP-SUD" || enterprise === "SASP-NORD") {
    return [
      { label: "Commandant", legacy: [`Patron ${enterprise}`, `Commandant ${enterprise}`], access: "manage", announcement: "write" },
      { label: "Capitaine", legacy: [`Co Patron ${enterprise}`, `Capitaine ${enterprise}`], access: "base", announcement: "write" }
    ];
  }
  if (enterprise === "D.O.J") {
    return [
      { label: "Juge", legacy: [`Patron ${enterprise}`, `Juge ${enterprise}`], access: "manage", announcement: "write" },
      { label: "Procureur", legacy: [`Co Patron ${enterprise}`, `Procureur ${enterprise}`], access: "base", announcement: "write" },
      { label: "Avocat", legacy: [`Employ\u00e9 ${enterprise}`, `Avocat ${enterprise}`], access: "base", announcement: "write" }
    ];
  }
  if (enterprise === "Gouvernement") {
    return [
      { label: "Gouverneur", legacy: [`Patron ${enterprise}`, `Gouverneur ${enterprise}`], access: "manage", announcement: "write" },
      { label: "Vice Gouverneur", legacy: [`Co Patron ${enterprise}`, `Vice Gouverneur ${enterprise}`], access: "base", announcement: "write" }
    ];
  }
  return [
    { label: "Patron", legacy: [`Patron ${enterprise}`], access: "manage", announcement: "write" },
    { label: "Co Patron", legacy: [`Co Patron ${enterprise}`], access: "base", announcement: "write" },
    { label: "Employ\u00e9", legacy: [`Employ\u00e9 ${enterprise}`], access: "base", announcement: "read" }
  ];
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

async function discordRequest(env, method, path, body, reason) {
  const res = await discordFetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
      ...(reason ? { "X-Audit-Log-Reason": reason } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function setupEnterpriseDiscord(env, guildId = ENTERPRISE_GUILD_ID, adminRoleId = ENTERPRISE_ADMIN_ROLE_ID, start = 0, limit = ENTERPRISES.length) {
  const VIEW = 1024n;
  const MANAGE_CHANNELS = 16n;
  const MANAGE_ROLES = 268435456n;
  const SEND = 2048n;
  const READ_HISTORY = 65536n;
  const BASE = VIEW | SEND | READ_HISTORY;
  const PATRON = BASE | MANAGE_CHANNELS | MANAGE_ROLES;
  const ADMIN = BASE | MANAGE_CHANNELS | MANAGE_ROLES;

  const roles = await discordRequest(env, "GET", `/guilds/${guildId}/roles`, null, "Setup entreprises");
  const channels = await discordRequest(env, "GET", `/guilds/${guildId}/channels`, null, "Setup entreprises");
  const roleByName = new Map(roles.map(r => [r.name, r]));
  let citizenRole = roleByName.get(ENTERPRISE_CITIZEN_ROLE);
  if (!citizenRole) {
    citizenRole = await discordRequest(env, "POST", `/guilds/${guildId}/roles`, {
      name: ENTERPRISE_CITIZEN_ROLE,
      color: 0x95a5a6,
      hoist: false,
      mentionable: true
    }, "Setup role citoyen entreprises");
    roleByName.set(ENTERPRISE_CITIZEN_ROLE, citizenRole);
  }
  const categoryByName = new Map();
  const channelByParentNameType = new Map();
  for (const channel of channels) {
    if (channel.type === 4) categoryByName.set(channel.name, channel);
    if (channel.parent_id) channelByParentNameType.set(`${channel.parent_id}:${channel.name}:${channel.type}`, channel);
  }

  const findOrCreateRole = async (legacyNames, displayName, color) => {
    const names = Array.isArray(legacyNames) ? legacyNames : [legacyNames];
    if (roleByName.has(displayName)) return { item: roleByName.get(displayName), created: false, renamed: false };
    const existingName = [...roleByName.keys()].find(name => names.some(legacyName =>
      name === legacyName ||
      name.endsWith(` ${legacyName}`) ||
      name.endsWith(`\u30fb${legacyName}`) ||
      name.endsWith(`ãƒ»${legacyName}`)
    ));
    if (existingName) {
      const existing = roleByName.get(existingName);
      const item = await discordRequest(env, "PATCH", `/guilds/${guildId}/roles/${existing.id}`, {
        name: displayName,
        color,
        hoist: false,
        mentionable: true
      }, "Setup entreprises - emoji role");
      roleByName.delete(existingName);
      roleByName.set(displayName, item);
      return { item, created: false, renamed: true };
    }
    const item = await discordRequest(env, "POST", `/guilds/${guildId}/roles`, {
      name: displayName,
      color,
      hoist: false,
      mentionable: true
    }, "Setup entreprises - role");
    roleByName.set(displayName, item);
    return { item, created: true, renamed: false };
  };

  const deleteRoleByLegacy = async (legacyNames) => {
    const names = Array.isArray(legacyNames) ? legacyNames : [legacyNames];
    const existingName = [...roleByName.keys()].find(name => names.some(legacyName =>
      name === legacyName ||
      name.endsWith(` ${legacyName}`) ||
      name.endsWith(`\u30fb${legacyName}`) ||
      name.endsWith(`ãƒ»${legacyName}`)
    ));
    if (!existingName) return false;
    const existing = roleByName.get(existingName);
    await discordRequest(env, "DELETE", `/guilds/${guildId}/roles/${existing.id}`, null, "Cleanup role entreprise inutile");
    roleByName.delete(existingName);
    return true;
  };

  const findOrCreateCategory = async (legacyName, displayName, overwrites) => {
    if (categoryByName.has(displayName)) return { item: categoryByName.get(displayName), created: false, renamed: false };
    const existingName = [...categoryByName.keys()].find(name => name === legacyName || name.endsWith(` ${legacyName}`) || name.endsWith(`\u30fb${legacyName}`) || name.endsWith(`ãƒ»${legacyName}`));
    if (existingName) {
      const existing = categoryByName.get(existingName);
      const item = await discordRequest(env, "PATCH", `/channels/${existing.id}`, {
        name: displayName,
        permission_overwrites: overwrites
      }, "Setup entreprises - emoji categorie");
      categoryByName.delete(existingName);
      categoryByName.set(displayName, item);
      return { item, created: false, renamed: true };
    }
    const item = await discordRequest(env, "POST", `/guilds/${guildId}/channels`, {
      name: displayName,
      type: 4,
      permission_overwrites: overwrites
    }, "Setup entreprises - categorie");
    categoryByName.set(displayName, item);
    return { item, created: true, renamed: false };
  };

  const findOrCreateChannel = async (parentId, legacyNames, displayName, type, overwrites) => {
    const names = Array.isArray(legacyNames) ? legacyNames : [legacyNames];
    const displayKey = `${parentId}:${displayName}:${type}`;
    if (channelByParentNameType.has(displayKey)) {
      const existing = channelByParentNameType.get(displayKey);
      const item = await discordRequest(env, "PATCH", `/channels/${existing.id}`, {
        permission_overwrites: overwrites
      }, "Setup entreprises - permissions salon");
      channelByParentNameType.set(displayKey, item);
      return { item, created: false, renamed: false };
    }
    const legacyName = names.find(name => channelByParentNameType.has(`${parentId}:${name}:${type}`));
    if (legacyName) {
      const legacyKey = `${parentId}:${legacyName}:${type}`;
      const existing = channelByParentNameType.get(legacyKey);
      const item = await discordRequest(env, "PATCH", `/channels/${existing.id}`, {
        name: displayName,
        permission_overwrites: overwrites
      }, "Setup entreprises - emoji salon");
      channelByParentNameType.delete(legacyKey);
      channelByParentNameType.set(displayKey, item);
      return { item, created: false, renamed: true };
    }
    const item = await discordRequest(env, "POST", `/guilds/${guildId}/channels`, {
      name: displayName,
      type,
      parent_id: parentId,
      permission_overwrites: overwrites
    }, "Setup entreprises - salon");
    channelByParentNameType.set(displayKey, item);
    return { item, created: true, renamed: false };
  };

  let createdRoles = 0;
  let renamedRoles = 0;
  let deletedRoles = 0;
  let createdCategories = 0;
  let renamedCategories = 0;
  let createdChannels = 0;
  let renamedChannels = 0;
  const details = [];

  const selectedEnterprises = ENTERPRISES.slice(start, start + limit);
  for (let localIndex = 0; localIndex < selectedEnterprises.length; localIndex++) {
    const i = start + localIndex;
    const enterprise = ENTERPRISES[i];
    const color = ENTERPRISE_COLORS[i % ENTERPRISE_COLORS.length];
    const roleSpecs = enterpriseRoleSpecs(enterprise);
    const roleEntries = [];
    for (const spec of roleSpecs) {
      const baseName = `${spec.label} ${enterprise}`;
      const result = await findOrCreateRole(spec.legacy, enterpriseRoleName(baseName, i), color);
      roleEntries.push({ ...spec, ...result });
    }
    createdRoles += roleEntries.filter(x => x.created).length;
    renamedRoles += roleEntries.filter(x => x.renamed).length;
    if (enterprise === "SASP-SUD" || enterprise === "SASP-NORD" || enterprise === "Gouvernement") {
      if (await deleteRoleByLegacy([`Employ\u00e9 ${enterprise}`])) deletedRoles++;
    }

    const categoryOverwrites = [
      { id: guildId, type: 0, deny: VIEW.toString() },
      { id: adminRoleId, type: 0, allow: ADMIN.toString() },
      ...roleEntries.map(entry => ({
        id: entry.item.id,
        type: 0,
        allow: (entry.access === "manage" ? PATRON : BASE).toString()
      }))
    ];
    const displayCategoryName = enterpriseCategoryName(enterprise, i);
    const category = await findOrCreateCategory(enterprise, displayCategoryName, categoryOverwrites);
    if (category.created) createdCategories++;
    if (category.renamed) renamedCategories++;

    const employeeEntries = roleEntries.filter(entry => entry.announcement === "read");
    const patronOnly = employeeEntries.map(entry => ({ id: entry.item.id, type: 0, deny: VIEW.toString() }));
    const citizenReadOnly = [{ id: citizenRole.id, type: 0, allow: (VIEW | READ_HISTORY).toString(), deny: SEND.toString() }];
    const announceOverwrites = [
      { id: citizenRole.id, type: 0, allow: (VIEW | READ_HISTORY).toString(), deny: SEND.toString() },
      ...roleEntries.map(entry => ({
        id: entry.item.id,
        type: 0,
        allow: (entry.announcement === "write" ? BASE : (VIEW | READ_HISTORY)).toString(),
        ...(entry.announcement === "write" ? {} : { deny: SEND.toString() })
      }))
    ];
    const desiredChannels = isPublicServiceEnterprise(enterprise)
      ? [
          { legacy: ["annonce"], name: "\ud83d\udce2annonce", type: 0, overwrites: announceOverwrites },
          { legacy: ["discussion"], name: "\ud83d\udde8\ufe0fdiscussion", type: 0, overwrites: [] }
        ]
      : [
          { legacy: ["annonce"], name: "\ud83d\udce2annonce", type: 0, overwrites: announceOverwrites },
          { legacy: ["discussion-patron", "discussions-patron"], name: "\ud83d\udde8\ufe0fdiscussions-patron", type: 0, overwrites: patronOnly },
          { legacy: ["discussion-employe"], name: "\ud83d\udde8\ufe0fdiscussion-employe", type: 0, overwrites: [] },
          { legacy: ["liaison-staff", "liaisson-staff"], name: "\ud83d\udd1eliaison-staff", type: 0, overwrites: patronOnly },
          { legacy: ["documents", "document"], name: "\ud83d\uddc3\ufe0fdocument", type: 15, overwrites: [] }
        ];
    const orderedChannels = [];
    for (const channel of desiredChannels) {
      const made = await findOrCreateChannel(category.item.id, channel.legacy, channel.name, channel.type, channel.overwrites);
      if (made.created) createdChannels++;
      if (made.renamed) renamedChannels++;
      orderedChannels.push(made.item);
    }
    await discordRequest(env, "PATCH", `/guilds/${guildId}/channels`, orderedChannels.map((channel, index) => ({
      id: channel.id,
      position: index
    })), "Reorder salons entreprises");
    details.push({ enterprise, category_id: category.item.id });
  }

  return {
    ok: true,
    guild_id: guildId,
    admin_role_id: adminRoleId,
    start,
    limit,
    total_enterprises: ENTERPRISES.length,
    processed_enterprises: selectedEnterprises.length,
    created_roles: createdRoles,
    renamed_roles: renamedRoles,
    deleted_roles: deletedRoles,
    created_categories: createdCategories,
    renamed_categories: renamedCategories,
    created_channels: createdChannels,
    renamed_channels: renamedChannels,
    details
  };
}

async function copySwatChannels(env, sourceGuildId = "1382167184607940658", targetGuildId = "1500975724750704661") {
  const sourceChannels = await discordRequest(env, "GET", `/guilds/${sourceGuildId}/channels`, null, "Copy SWAT source channels");
  const targetChannels = await discordRequest(env, "GET", `/guilds/${targetGuildId}/channels`, null, "Copy SWAT target channels");

  const normalize = (name) => String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  const simplifyName = (name) => normalize(String(name || "").split(/[・•]/).pop() || name);

  const sourceCategory = sourceChannels.find(channel =>
    channel.type === 4 &&
    (normalize(channel.name).includes("swat") || channel.name.includes("S.W.A.T"))
  );
  if (!sourceCategory) throw new Error(`Categorie S.W.A.T introuvable sur ${sourceGuildId}`);

  let targetCategory = targetChannels.find(channel =>
    channel.type === 4 &&
    (normalize(channel.name) === "swat" || normalize(channel.name).includes("swat"))
  );
  let createdCategory = false;
  if (!targetCategory) {
    targetCategory = await discordRequest(env, "POST", `/guilds/${targetGuildId}/channels`, {
      name: "SWAT",
      type: 4
    }, "Create SWAT category");
    createdCategory = true;
  }

  const sourceChildren = sourceChannels
    .filter(channel => channel.parent_id === sourceCategory.id)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const targetChildren = targetChannels.filter(channel => channel.parent_id === targetCategory.id);

  const targetByKey = new Map();
  const pushTarget = (key, channel) => {
    if (!targetByKey.has(key)) targetByKey.set(key, []);
    targetByKey.get(key).push(channel);
  };
  for (const channel of targetChildren) {
    pushTarget(`${normalize(channel.name)}:${channel.type}`, channel);
    pushTarget(`${simplifyName(channel.name)}:${channel.type}`, channel);
  }

  const created = [];
  const renamed = [];
  const kept = [];
  const ordered = [];
  const usedTargetIds = new Set();

  for (const source of sourceChildren) {
    const key = `${normalize(source.name)}:${source.type}`;
    const simpleKey = `${simplifyName(source.name)}:${source.type}`;
    const candidates = [...(targetByKey.get(key) || []), ...(targetByKey.get(simpleKey) || [])];
    let target = candidates.find(channel => !usedTargetIds.has(channel.id));
    const payload = {
      name: source.name,
      parent_id: targetCategory.id,
      topic: source.topic || undefined,
      nsfw: Boolean(source.nsfw),
      rate_limit_per_user: source.rate_limit_per_user || 0
    };

    if (target) {
      if (target.name !== source.name || target.parent_id !== targetCategory.id) {
        target = await discordRequest(env, "PATCH", `/channels/${target.id}`, payload, "Rename SWAT channel");
        renamed.push({ id: target.id, name: target.name });
      } else {
        kept.push({ id: target.id, name: target.name });
      }
    } else {
      const createPayload = { ...payload, type: source.type };
      if (source.type === 15) {
        createPayload.available_tags = source.available_tags || [];
        createPayload.default_sort_order = source.default_sort_order ?? null;
        createPayload.default_forum_layout = source.default_forum_layout ?? 0;
      }
      target = await discordRequest(env, "POST", `/guilds/${targetGuildId}/channels`, createPayload, "Create SWAT channel");
      created.push({ id: target.id, name: target.name, type: target.type });
    }
    usedTargetIds.add(target.id);
    ordered.push(target);
  }

  if (ordered.length) {
    await discordRequest(env, "PATCH", `/guilds/${targetGuildId}/channels`, ordered.map((channel, index) => ({
      id: channel.id,
      position: index
    })), "Order SWAT channels");
  }

  return {
    ok: true,
    source_guild_id: sourceGuildId,
    target_guild_id: targetGuildId,
    source_category: sourceCategory.name,
    target_category: targetCategory.name,
    created_category: createdCategory,
    source_channels: sourceChildren.map(channel => ({ name: channel.name, type: channel.type })),
    created,
    renamed,
    kept
  };
}

// â”€â”€ Supabase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function setupEnterpriseGeneral(env, guildId = ENTERPRISE_GUILD_ID, adminRoleId = ENTERPRISE_ADMIN_ROLE_ID, start = 0, limit = ENTERPRISES.length) {
  const VIEW = 1024n;
  const MANAGE_CHANNELS = 16n;
  const MANAGE_ROLES = 268435456n;
  const SEND = 2048n;
  const READ_HISTORY = 65536n;
  const BASE = VIEW | SEND | READ_HISTORY;
  const ADMIN = BASE | MANAGE_CHANNELS | MANAGE_ROLES;

  const roles = await discordRequest(env, "GET", `/guilds/${guildId}/roles`, null, "Setup role citoyen entreprises");
  let citizenRole = roles.find(role => role.name === ENTERPRISE_CITIZEN_ROLE);
  let createdCitizenRole = false;
  if (!citizenRole) {
    citizenRole = await discordRequest(env, "POST", `/guilds/${guildId}/roles`, {
      name: ENTERPRISE_CITIZEN_ROLE,
      color: 0x95a5a6,
      hoist: false,
      mentionable: true
    }, "Setup role citoyen entreprises");
    createdCitizenRole = true;
  }

  const channels = await discordRequest(env, "GET", `/guilds/${guildId}/channels`, null, "Setup entreprises general");
  const categories = channels.filter(channel => channel.type === 4);
  const enterpriseCategories = categories
    .filter(channel => isEnterpriseCategoryName(channel.name))
    .slice(start, start + limit);

  let deletedChannels = 0;
  for (const category of enterpriseCategories) {
    const children = channels.filter(channel =>
      channel.parent_id === category.id &&
      ENTERPRISE_GENERAL_CHANNELS.includes(channel.name)
    );
    for (const channel of children) {
      await discordRequest(env, "DELETE", `/channels/${channel.id}`, null, "Cleanup salons generaux entreprises");
      deletedChannels++;
    }
  }

  let generalCategory = categories.find(channel => channel.name === ENTERPRISE_GENERAL_CATEGORY || channel.name === "General" || channel.name === "GÃ©nÃ©ral");
  let createdCategory = false;
  const generalOverwrites = [
    { id: guildId, type: 0, allow: BASE.toString() },
    { id: citizenRole.id, type: 0, allow: BASE.toString() },
    { id: adminRoleId, type: 0, allow: ADMIN.toString() }
  ];
  if (generalCategory) {
    generalCategory = await discordRequest(env, "PATCH", `/channels/${generalCategory.id}`, {
      name: ENTERPRISE_GENERAL_CATEGORY,
      permission_overwrites: generalOverwrites
    }, "Setup categorie general entreprises");
  } else {
    generalCategory = await discordRequest(env, "POST", `/guilds/${guildId}/channels`, {
      name: ENTERPRISE_GENERAL_CATEGORY,
      type: 4,
      permission_overwrites: generalOverwrites
    }, "Setup categorie general entreprises");
    createdCategory = true;
  }

  let createdGeneralChannels = 0;
  let renamedGeneralChannels = 0;
  const refreshedChannels = await discordRequest(env, "GET", `/guilds/${guildId}/channels`, null, "Setup salons general entreprises");
  const orderedGeneralChannels = [];
  for (const wanted of ENTERPRISE_GENERAL_CHANNEL_LABELS) {
    let channel = refreshedChannels.find(ch => ch.parent_id === generalCategory.id && ch.name === wanted.name && ch.type === 0);
    if (!channel) {
      channel = refreshedChannels.find(ch => ch.parent_id === generalCategory.id && wanted.legacy.includes(ch.name) && ch.type === 0);
      if (channel) {
        channel = await discordRequest(env, "PATCH", `/channels/${channel.id}`, {
          name: wanted.name
        }, "Setup salons general entreprises");
        renamedGeneralChannels++;
      }
    }
    if (!channel) {
      channel = await discordRequest(env, "POST", `/guilds/${guildId}/channels`, {
        name: wanted.name,
        type: 0,
        parent_id: generalCategory.id,
        permission_overwrites: []
      }, "Setup salons general entreprises");
      createdGeneralChannels++;
    }
    orderedGeneralChannels.push(channel);
  }
  await discordRequest(env, "PATCH", `/guilds/${guildId}/channels`, orderedGeneralChannels.map((channel, index) => ({
    id: channel.id,
    position: index
  })), "Reorder salons general entreprises");

  return {
    ok: true,
    guild_id: guildId,
    admin_role_id: adminRoleId,
    start,
    limit,
    processed_categories: enterpriseCategories.length,
    deleted_channels: deletedChannels,
    created_general_category: createdCategory,
    created_general_channels: createdGeneralChannels,
    renamed_general_channels: renamedGeneralChannels,
    created_citizen_role: createdCitizenRole,
    citizen_role_id: citizenRole.id,
    general_category_id: generalCategory.id
  };
}

async function setupPublicServiceCategories(env, guildId = ENTERPRISE_GUILD_ID) {
  const channels = await discordRequest(env, "GET", `/guilds/${guildId}/channels`, null, "Setup categories publiques");
  const categories = channels.filter(channel => channel.type === 4);
  const targets = PUBLIC_SERVICE_ENTERPRISES.map(enterprise => ({
    enterprise,
    category: categories.find(channel =>
      channel.name === enterprise ||
      channel.name.endsWith(` ${enterprise}`) ||
      channel.name.endsWith(`\u30fb${enterprise}`) ||
      channel.name.endsWith(`Ã£Æ’Â»${enterprise}`) ||
      channel.name.endsWith(`ÃƒÂ£Ã†â€™Ã‚Â»${enterprise}`)
    )
  })).filter(item => item.category);

  let deletedChannels = 0;
  let createdChannels = 0;
  for (const target of targets) {
    const desired = [
      { legacy: ["annonce"], name: "\ud83d\udce2annonce" },
      { legacy: ["discussion"], name: "\ud83d\udde8\ufe0fdiscussion" }
    ];
    const wantedNames = desired.flatMap(channel => [channel.name, ...channel.legacy]);
    const children = channels.filter(channel => channel.parent_id === target.category.id);
    for (const channel of children) {
      if (wantedNames.includes(channel.name) && channel.type === 0) continue;
      await discordRequest(env, "DELETE", `/channels/${channel.id}`, null, "Cleanup categorie publique");
      deletedChannels++;
    }

    const refreshed = await discordRequest(env, "GET", `/guilds/${guildId}/channels`, null, "Setup salons categories publiques");
    const ordered = [];
    for (const wanted of desired) {
      let existing = refreshed.find(channel => channel.parent_id === target.category.id && channel.name === wanted.name && channel.type === 0);
      if (!existing) {
        existing = refreshed.find(channel => channel.parent_id === target.category.id && wanted.legacy.includes(channel.name) && channel.type === 0);
      }
      if (existing) {
        existing = await discordRequest(env, "PATCH", `/channels/${existing.id}`, { name: wanted.name }, "Setup salons categories publiques");
      } else {
        existing = await discordRequest(env, "POST", `/guilds/${guildId}/channels`, {
          name: wanted.name,
          type: 0,
          parent_id: target.category.id,
          permission_overwrites: []
        }, "Setup salons categories publiques");
        createdChannels++;
      }
      ordered.push(existing);
    }
    await discordRequest(env, "PATCH", `/guilds/${guildId}/channels`, ordered.map((channel, index) => ({
      id: channel.id,
      position: index
    })), "Reorder salons categories publiques");
  }

  await discordRequest(env, "PATCH", `/guilds/${guildId}/channels`, targets.map((target, index) => ({
    id: target.category.id,
    position: index
  })), "Reorder categories publiques");

  return {
    ok: true,
    guild_id: guildId,
    processed_categories: targets.length,
    deleted_channels: deletedChannels,
    created_channels: createdChannels,
    category_ids: targets.map(target => target.category.id)
  };
}

async function cleanupEnterpriseDuplicates(env, guildId = ENTERPRISE_GUILD_ID, start = 0, limit = ENTERPRISES.length) {
  const channels = await discordRequest(env, "GET", `/guilds/${guildId}/channels`, null, "Cleanup doublons entreprises");
  const categories = channels.filter(channel => channel.type === 4);
  let deletedCategories = 0;
  let deletedChannels = 0;
  let renamedChannels = 0;

  for (let i = start; i < Math.min(start + limit, ENTERPRISES.length); i++) {
    const enterprise = ENTERPRISES[i];
    const matchingCategories = categories.filter(category => category.name.includes(enterprise));
    if (!matchingCategories.length) continue;

    const desiredCategoryName = enterpriseCategoryName(enterprise, i);
    const keeper = matchingCategories.find(category => category.name === desiredCategoryName) || matchingCategories[0];
    const duplicateCategories = matchingCategories.filter(category => category.id !== keeper.id);
    for (const category of duplicateCategories) {
      const children = channels.filter(channel => channel.parent_id === category.id);
      for (const child of children) {
        await discordRequest(env, "DELETE", `/channels/${child.id}`, null, "Cleanup salons categorie doublon");
        deletedChannels++;
      }
      await discordRequest(env, "DELETE", `/channels/${category.id}`, null, "Cleanup categorie doublon");
      deletedCategories++;
    }

    const desired = isPublicServiceEnterprise(enterprise)
      ? [
          { names: ["annonce", "\ud83d\udce2annonce"], display: "\ud83d\udce2annonce", type: 0 },
          { names: ["discussion", "\ud83d\udde8\ufe0fdiscussion"], display: "\ud83d\udde8\ufe0fdiscussion", type: 0 }
        ]
      : [
          { names: ["annonce", "\ud83d\udce2annonce"], display: "\ud83d\udce2annonce", type: 0 },
          { names: ["discussion-patron", "discussions-patron", "\ud83d\udde8\ufe0fdiscussions-patron"], display: "\ud83d\udde8\ufe0fdiscussions-patron", type: 0 },
          { names: ["discussion-employe", "\ud83d\udde8\ufe0fdiscussion-employe"], display: "\ud83d\udde8\ufe0fdiscussion-employe", type: 0 },
          { names: ["liaison-staff", "liaisson-staff", "\ud83d\udd1eliaison-staff"], display: "\ud83d\udd1eliaison-staff", type: 0 },
          { names: ["documents", "document", "\ud83d\uddc3\ufe0fdocument"], display: "\ud83d\uddc3\ufe0fdocument", type: 15 }
        ];

    const keeperChildren = channels.filter(channel => channel.parent_id === keeper.id);
    for (const wanted of desired) {
      const matches = keeperChildren.filter(channel => channel.type === wanted.type && wanted.names.includes(channel.name));
      if (!matches.length) continue;
      const keep = matches.find(channel => channel.name === wanted.display) || matches[0];
      if (keep.name !== wanted.display) {
        await discordRequest(env, "PATCH", `/channels/${keep.id}`, { name: wanted.display }, "Cleanup nom salon entreprise");
        renamedChannels++;
      }
      for (const extra of matches.filter(channel => channel.id !== keep.id)) {
        await discordRequest(env, "DELETE", `/channels/${extra.id}`, null, "Cleanup salon doublon entreprise");
        deletedChannels++;
      }
    }
  }

  return { ok: true, guild_id: guildId, start, limit, processed_enterprises: Math.max(0, Math.min(start + limit, ENTERPRISES.length) - start), deleted_categories: deletedCategories, deleted_channels: deletedChannels, renamed_channels: renamedChannels };
}

async function sb(env, method, path, body) {
  return sbForSite(env, method, path, body, "sud");
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

async function sbForSite(env, method, path, body, siteKey = "sud") {
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

function ftfRowToDossier(row) {
  return row && row.data ? row.data : null;
}

function dataUrlToBytes(dataUrl) {
  const input = String(dataUrl || "");
  const match = input.match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error("Image PNG invalide");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getFtfDossiers(env) {
  const rows = await sb(env, "GET", "/ftf_dossiers?select=id,data,updated_at&order=updated_at.desc");
  return (Array.isArray(rows) ? rows : []).map(ftfRowToDossier).filter(Boolean);
}

async function getFtfDossier(env, id) {
  const rows = await sb(env, "GET", `/ftf_dossiers?id=eq.${encodeURIComponent(id)}&select=id,data,updated_at&limit=1`);
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  return ftfRowToDossier(row);
}

const BACKUP_TABLES = [
  "app_users",
  "agents",
  "grades",
  "units",
  "agent_historique",
  "dossiers_disciplinaires",
  "agent_armes",
  "wiki_sections",
  "mdt_categories",
  "mdt_pages",
  "service_logements",
  "service_logement_paiements",
  "pointages",
  "ceremonie_votes",
  "ftf_dossiers"
];

async function exportSiteBackup(env, siteKey = "sud") {
  const tables = {};
  const errors = {};
  for (const table of BACKUP_TABLES) {
    try {
      const rows = await sbForSite(env, "GET", `/${table}?select=*`, null, siteKey);
      tables[table] = Array.isArray(rows) ? rows : [];
    } catch (e) {
      tables[table] = [];
      errors[table] = e.message;
    }
  }
  return {
    ok: true,
    site: siteKey,
    generated_at: new Date().toISOString(),
    tables,
    errors
  };
}

async function upsertFtfDossier(env, dossier) {
  if (!dossier || !dossier.id) throw new Error("Dossier FTF invalide");
  const now = new Date().toISOString();
  const data = { ...dossier, updated_at: dossier.updated_at || now };
  await sb(env, "POST", "/ftf_dossiers?on_conflict=id", {
    id: data.id,
    data,
    updated_at: data.updated_at
  });
  return data;
}

async function getAgentByDiscordId(env, discordId, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/agents?discord_id=eq.${discordId}&select=id,nom,prenom,matricule,discord_id,grade,iban&limit=1`, null, siteKey);
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

async function getAgentIdentityForInteraction(env, interaction) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  try {
    const agent = await getAgentByDiscordId(env, userId);
    if (agent) return { nom: agent.nom || "", prenom: agent.prenom || "", matricule: agent.matricule || "", iban: agent.iban || "", source: "fiche" };
  } catch {}
  const member = interaction.member || {};
  const user = member.user || interaction.user || {};
  const displayName = member.nick || user.global_name || user.username || "";
  const parsed = parseAgentIdentityFromDiscordName(displayName);
  if (parsed?.matricule) {
    try {
      const agent = await getAgentByMatricule(env, parsed.matricule);
      if (agent) return { nom: agent.nom || parsed.nom || "", prenom: agent.prenom || parsed.prenom || "", matricule: agent.matricule || parsed.matricule || "", iban: agent.iban || "", source: "fiche" };
    } catch {}
  }
  if (parsed) return { ...parsed, iban: "", source: "discord" };
  return { nom: "", prenom: displayName || `<@${userId}>`, matricule: "", iban: "", source: "discord" };
}

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

async function getAgentByMatricule(env, matricule, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/agents?matricule=eq.${matricule}&select=id,nom,prenom,matricule,discord_id,iban&limit=1`, null, siteKey);
  return data && data.length > 0 ? data[0] : null;
}

async function getAgentById(env, agentId, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/agents?id=eq.${agentId}&select=id,nom,prenom,matricule,discord_id&limit=1`, null, siteKey);
  return data && data.length > 0 ? data[0] : null;
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

async function updateInteractionOriginal(env, appId, token, content) {
  if (!appId || !token) return;
  await discordFetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, components: [] })
  });
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

function startOfCurrentWeekUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

function formatDurationFromMs(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

function formatMoney(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("fr-FR")} $`;
}

async function getWeeklyServiceSummary(env, agent, siteKey = "sud", now = new Date()) {
  const weekStart = startOfCurrentWeekUtc(now);
  const rows = await sbForSite(
    env,
    "GET",
    `/pointages?agent_id=eq.${agent.id}&select=id,clock_in,clock_out&order=clock_in.asc`,
    null,
    siteKey
  );
  const sessions = (Array.isArray(rows) ? rows : []).map(p => {
    const start = new Date(p.clock_in);
    const end = p.clock_out ? new Date(p.clock_out) : now;
    const clippedStart = start < weekStart ? weekStart : start;
    const clippedEnd = end > now ? now : end;
    const durationMs = Math.max(0, clippedEnd - clippedStart);
    return { ...p, start, end, durationMs };
  }).filter(p => p.durationMs > 0 && p.end >= weekStart);

  const totalMs = sessions.reduce((sum, p) => sum + p.durationMs, 0);
  const hourlyRate = GRADE_SALAIRE[agent.grade] || 0;
  const totalHours = totalMs / 3600000;
  return {
    weekStart,
    sessions,
    totalMs,
    totalHours,
    hourlyRate,
    pay: totalHours * hourlyRate
  };
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

const SERVICE_CONFIRM_AFTER_MS = 5 * 60 * 60 * 1000;
const SERVICE_CONFIRM_REPEAT_MS = 2 * 60 * 60 * 1000;
const SERVICE_CONFIRM_GRACE_MS = 15 * 60 * 1000;
const POINTEUSE_LOG_CHANNEL_ID = "1519525957390827711";

function addMsIso(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
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
        { type: 2, style: 4, label: "Non, terminer mon service", emoji: { name: "🔴" }, custom_id: `pointeuse_confirm_no|${siteKey}|${pointage.id}` }
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
        { type: 2, style: 4, label: "Non, terminer mon service", emoji: { name: "🔴" }, custom_id: "pointeuse_confirm_closed_no", disabled: true }
      ]
    }]
  };
}

async function getPointageById(env, pointageId, siteKey = "sud") {
  const rows = await sbForSite(
    env,
    "GET",
    `/pointages?id=eq.${encodeURIComponent(pointageId)}&select=id,agent_id,clock_in,clock_out,last_confirmation_at,confirmation_count,next_confirmation_at,confirmation_requested_at,confirmation_channel_id,confirmation_message_id,discord_id,agents(nom,prenom,matricule,discord_id)&limit=1`,
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
  const closed = await closePointage(env, pointage, siteKey, "AUTO_CLOSED");
  const a = pointage.agents || {};
  const userId = pointage.discord_id || a.discord_id;
  const description = "Votre service a été automatiquement clôturé car aucune confirmation n'a été reçue.\n\nSi vous étiez toujours en service, contactez un membre du Command Staff afin que votre temps puisse être corrigé.";
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
        { name: "Durée retenue", value: formatDurationFromMs(closed.duration_seconds * 1000), inline: true }
      ],
      footer: { text: "SASP · Pointeuse" },
      timestamp: closed.clock_out
    }]
  }).catch(() => null);
}

async function processPointeuseConfirmations(env, siteKey = "sud") {
  const nowMs = Date.now();
  const active = await sbForSite(
    env,
    "GET",
    `/pointages?clock_out=is.null&select=id,agent_id,clock_in,last_confirmation_at,confirmation_count,next_confirmation_at,confirmation_requested_at,confirmation_channel_id,confirmation_message_id,discord_id,agents(nom,prenom,matricule,discord_id)&order=clock_in.asc`,
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

  const closed = await closePointage(env, pointage, siteKey, "manual");
  if (interaction.channel_id && interaction.message?.id) {
    await editMessage(env, interaction.channel_id, interaction.message.id, buildDisabledPointeuseConfirmationDm(
      "🔴 SASP — Fin de service enregistrée",
      `Votre service a été clôturé.\nDurée totale : **${formatDurationFromMs(closed.duration_seconds * 1000)}**.`,
      0xe74c3c
    )).catch(() => null);
  }
  if (env.POINTEUSE_CHANNEL_ID && env.POINTEUSE_MESSAGE_ID) {
    await refreshPointeuseMessage(env, env.POINTEUSE_CHANNEL_ID, env.POINTEUSE_MESSAGE_ID, siteKey).catch(() => null);
  }
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

async function sendFtfLog(env, title, description, color = 0xc9a84c) {
  if (!FTF_LOG_CHANNEL_ID || !env.DISCORD_BOT_TOKEN) return;
  try {
    await discordFetch(`${DISCORD_API}/channels/${FTF_LOG_CHANNEL_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        embeds: [{
          title,
          description,
          color,
          footer: { text: "SASP - FTF logs" },
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (_) {}
}

async function deleteRecentChannelMessages(env, channelId, count) {
  const limit = Math.max(1, Math.min(Number(count) || 1, 100));
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`, {
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Lecture messages impossible (${res.status}) ${err}`);
  }
  const messages = await res.json();
  const ids = (messages || []).map(m => m.id).filter(Boolean);
  if (!ids.length) return { deleted: 0, skipped: 0 };

  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const youngIds = [];
  const oldIds = [];
  for (const id of ids) {
    const timestamp = Number((BigInt(id) >> 22n) + 1420070400000n);
    if (timestamp > fourteenDaysAgo) youngIds.push(id);
    else oldIds.push(id);
  }

  let deleted = 0;
  if (youngIds.length === 1) {
    const del = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${youngIds[0]}`, {
      method: "DELETE",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (del.ok || del.status === 404) deleted++;
  } else if (youngIds.length > 1) {
    const bulk = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/bulk-delete`, {
      method: "POST",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: youngIds })
    });
    if (!bulk.ok) {
      const err = await bulk.text().catch(() => "");
      throw new Error(`Suppression bulk impossible (${bulk.status}) ${err}`);
    }
    deleted += youngIds.length;
  }

  for (const id of oldIds) {
    const del = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${id}`, {
      method: "DELETE",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
    });
    if (del.ok || del.status === 404) deleted++;
  }

  return { deleted, skipped: ids.length - deleted };
}

async function cloneAndDeleteChannel(env, guildId, channelId) {
  const infoRes = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!infoRes.ok) {
    const err = await infoRes.text().catch(() => "");
    throw new Error(`Lecture salon impossible (${infoRes.status}) ${err}`);
  }
  const channel = await infoRes.json();
  const payload = {
    name: channel.name,
    type: channel.type,
    parent_id: channel.parent_id || undefined,
    topic: channel.topic || undefined,
    nsfw: Boolean(channel.nsfw),
    rate_limit_per_user: channel.rate_limit_per_user || 0,
    permission_overwrites: channel.permission_overwrites || []
  };
  if (channel.type === 15) {
    payload.available_tags = channel.available_tags || [];
    payload.default_sort_order = channel.default_sort_order ?? null;
    payload.default_forum_layout = channel.default_forum_layout ?? 0;
  }
  const createRes = await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => "");
    throw new Error(`Duplication salon impossible (${createRes.status}) ${err}`);
  }
  const created = await createRes.json();
  await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: "PATCH",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ id: created.id, position: channel.position || 0 }])
  }).catch(() => null);
  const deleteRes = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    method: "DELETE",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!deleteRes.ok) {
    const err = await deleteRes.text().catch(() => "");
    throw new Error(`Suppression ancien salon impossible (${deleteRes.status}) ${err}`);
  }
  return { old_channel_id: channelId, new_channel_id: created.id, name: created.name };
}

async function renameDefconStatusChannel(env, level) {
  const name = DEFCON_CHANNEL_NAMES[String(level)];
  if (!name || !DEFCON_STATUS_CHANNEL_ID || !env.DISCORD_BOT_TOKEN) return false;

  try {
    const response = await discordFetch(`${DISCORD_API}/channels/${DEFCON_STATUS_CHANNEL_ID}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.log("DEFCON channel rename failed", response.status, errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.log("DEFCON channel rename error", error?.message || error);
    return false;
  }
}

async function createServiceHousingLiaison(env, interaction, gamme) {
  const VIEW = "1024";
  const SEND = "2048";
  const READ_HISTORY = "65536";
  const MANAGE_CHANNELS = "16";
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) throw new Error("Utilisateur introuvable");

  const isHigh = gamme === "haut";
  const label = isHigh ? "haut de gamme" : "bas de gamme";
  const housingImageUrl = isHigh
    ? "https://louiis-hub.github.io/sasp-intranet/assets/service-housing-luxury-3.png"
    : "https://louiis-hub.github.io/sasp-intranet/assets/service-housing-safe-house.png";
  const channelName = `location-${isHigh ? "haut" : "bas"}-${userId.slice(-4)}`;
  const staffRoles = Array.from(new Set([...ADMIN_ROLE_IDS, ...STAFF_ROLE_IDS]));
  const permissionOverwrites = [
    { id: interaction.guild_id, type: 0, deny: VIEW },
    { id: userId, type: 1, allow: String(BigInt(VIEW) | BigInt(SEND) | BigInt(READ_HISTORY)) },
    ...staffRoles.map(roleId => ({
      id: roleId,
      type: 0,
      allow: String(BigInt(VIEW) | BigInt(SEND) | BigInt(READ_HISTORY) | BigInt(MANAGE_CHANNELS))
    }))
  ];

  const createRes = await discordFetch(`${DISCORD_API}/guilds/${interaction.guild_id}/channels`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: channelName,
      type: 0,
      parent_id: SERVICE_HOUSING_CATEGORY_ID,
      topic: `Location logement ${label} - demandeur ${userId}`,
      permission_overwrites: permissionOverwrites
    })
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => "");
    throw new Error(`Creation liaison impossible (${createRes.status}) ${err}`);
  }
  const channel = await createRes.json();

  const msgRes = await discordFetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `<@${userId}>`,
      embeds: [{
        title: "Demande de logement de service",
        description: `<@${userId}> souhaite louer un logement **${label}**.`,
        color: isHigh ? 0xc9a84c : 0x3498db,
        fields: [
          { name: "Type", value: isHigh ? "Haut de gamme" : "Bas de gamme", inline: true },
          { name: "Loyer", value: isHigh ? "3500 $ / semaine" : "2500 $ / semaine", inline: true },
          { name: "Délai de traitement", value: "Réponse sous **24 à 48 heures** selon les disponibilités.", inline: false },
          { name: "Conditions", value: "La demande peut être refusée si l'agent est **suspendu**, **inactif** ou **déjà logé**.", inline: false },
          { name: "Paiement", value: "Tout impayé peut entraîner le **retrait du logement de service**.", inline: false },
          { name: "Suivi", value: "Merci de confirmer la disponibilite, le logement attribue et la date de debut.", inline: false }
        ],
        image: { url: housingImageUrl },
        footer: { text: "SASP - Logements de service" },
        timestamp: new Date().toISOString()
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 4, label: "Fermer la liaison", custom_id: `service_housing_close|${userId}` }
        ]
      }],
      allowed_mentions: { users: [userId], parse: [] }
    })
  });
  if (!msgRes.ok) {
    const err = await msgRes.text().catch(() => "");
    throw new Error(`Message liaison impossible (${msgRes.status}) ${err}`);
  }

  return { channel_id: channel.id, label };
}

function ticketSafeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[ß]/g, "ss")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "ticket";
}

function ticketRequesterRawName(interaction) {
  const member = interaction.member || {};
  const user = member.user || interaction.user || {};
  return member.nick || user.global_name || user.username || user.id || "demandeur";
}

function ticketBuildChannelName(prefix, rawName, interaction, userId) {
  const safePrefix = prefix ? ticketSafeName(prefix) : "";
  const fallbackRaw = ticketRequesterRawName(interaction);
  let safeName = ticketSafeName(rawName || fallbackRaw);
  if (!safeName || safeName === "ticket") safeName = ticketSafeName(fallbackRaw);
  if (!safeName || safeName === "ticket") safeName = String(userId || "").slice(-4) || "demandeur";

  const candidate = safePrefix ? `${safePrefix}-${safeName}` : safeName;
  const finalName = ticketSafeName(candidate);
  if (safePrefix && finalName === safePrefix) {
    return `${safePrefix}-${String(userId || "").slice(-4) || "demandeur"}`.slice(0, 95);
  }
  return finalName.slice(0, 95);
}

const TICKET_VIEW_PERM = "1024";
const TICKET_BASE_PERMS = String(1024n | 2048n | 65536n | 32768n | 16384n);

function ticketRoleIdsFromValue(value) {
  if (Array.isArray(value)) return Array.from(new Set(value.map(v => String(v || "").replace(/\D/g, "")).filter(Boolean)));
  if (typeof value === "string") return Array.from(new Set(value.split(/[\s,;]+/).map(v => v.replace(/\D/g, "")).filter(Boolean)));
  return [];
}

function ticketOptionRoleIds(option = {}) {
  const explicit = Array.isArray(option.roleIds) ? option.roleIds : option.role_ids;
  const fallback = option.roleId || option.role_id || "";
  return ticketRoleIdsFromValue(explicit || fallback);
}

function ticketIsEtatMajorOption(option = {}) {
  const key = String(option.key || "").toLowerCase();
  const label = String(option.label || "").toLowerCase();
  return key === "em" || key === "etat-major" || key.includes("etat-major") || label.includes("etat-major") || label.includes("etat major");
}

function ticketIsPoliceAcademyOption(option = {}) {
  const key = String(option.key || "").toLowerCase();
  const label = String(option.label || "").toLowerCase();
  return key.includes("police-academy") || key.includes("academy") || label.includes("police academy");
}

function ticketAccessRoleIds(option = {}) {
  const roleIds = [
    ...ticketOptionRoleIds(option),
    ...ticketIdList(option.support_role_ids),
    ...ticketIdList(option.manager_role_ids)
  ];
  if (ticketIsPoliceAcademyOption(option)) roleIds.push(TICKET_POLICE_ACADEMY_ACCESS_ROLE_ID);
  return ticketRoleIdsFromValue(roleIds);
}

function ticketMentionRoleIds(option = {}) {
  const explicit = Array.isArray(option.mentionRoleIds) ? option.mentionRoleIds : option.mention_role_ids;
  const fallback = ticketOptionRoleIds(option);
  const roleIds = ticketRoleIdsFromValue(explicit && explicit.length ? explicit : fallback);
  return roleIds.filter(roleId => roleId !== TICKET_EM_SUPERVISOR_ROLE_ID || ticketIsEtatMajorOption(option));
}

function ticketRoleToken(roleIds = []) {
  return ticketRoleIdsFromValue(roleIds).join(",");
}

function hasTicketAdminRole(member, roleId = "") {
  const roleIds = ticketRoleIdsFromValue(roleId);
  return hasStaffRole(member) || (!!roleIds.length && memberHasAnyRole(member, roleIds));
}

async function setTicketRequesterVisibility(env, channelId, requesterId, visible) {
  const body = visible
    ? { type: 1, allow: TICKET_BASE_PERMS, deny: "0" }
    : { type: 1, allow: "0", deny: TICKET_VIEW_PERM };
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/permissions/${requesterId}`, {
    method: "PUT",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Modification permissions ticket impossible (${res.status}) ${await res.text().catch(() => "")}`);
}

function commandOptionValue(interaction, name) {
  return interaction?.data?.options?.find(option => option.name === name)?.value;
}

function isTicketChannelInfo(channel) {
  const name = String(channel?.name || "");
  const topic = String(channel?.topic || "");
  return (
    /\bdemandeur\s+\d{16,22}\b/i.test(topic) ||
    /\bticket\b/i.test(topic) ||
    /^ticket[-_]/i.test(name) ||
    /^rc(?:-|$)/i.test(name)
  );
}

async function getTicketCommandChannel(env, interaction) {
  const channelId = String(interaction.channel_id || "").replace(/\D/g, "");
  if (!channelId) throw new Error("Salon introuvable.");
  const channel = await discordRequest(env, "GET", `/channels/${channelId}`);
  if (!isTicketChannelInfo(channel)) {
    const err = new Error("Commande disponible uniquement dans un ticket.");
    err.isUserError = true;
    throw err;
  }
  return channel;
}

async function sendTicketCommandLog(env, channelId, content) {
  await discordRequest(env, "POST", `/channels/${channelId}/messages`, {
    content,
    allowed_mentions: { parse: [] }
  });
}

async function addTicketMember(env, interaction, targetId) {
  const channel = await getTicketCommandChannel(env, interaction);
  await discordRequest(env, "PUT", `/channels/${channel.id}/permissions/${targetId}`, {
    type: 1,
    allow: TICKET_BASE_PERMS,
    deny: "0"
  });
  const actorId = interaction.member?.user?.id || interaction.user?.id;
  await sendTicketCommandLog(env, channel.id, `<@${targetId}> a ete ajoute au ticket par <@${actorId}>.`);
}

async function removeTicketMember(env, interaction, targetId) {
  const channel = await getTicketCommandChannel(env, interaction);
  await discordRequest(env, "DELETE", `/channels/${channel.id}/permissions/${targetId}`);
  const actorId = interaction.member?.user?.id || interaction.user?.id;
  await sendTicketCommandLog(env, channel.id, `<@${targetId}> a ete retire du ticket par <@${actorId}>.`);
}

async function renameTicketChannel(env, interaction, rawName) {
  const channel = await getTicketCommandChannel(env, interaction);
  const name = ticketSafeName(rawName);
  if (!name || name === "ticket") {
    const err = new Error("Nom de ticket invalide.");
    err.isUserError = true;
    throw err;
  }
  await discordRequest(env, "PATCH", `/channels/${channel.id}`, { name: name.slice(0, 95) });
  const actorId = interaction.member?.user?.id || interaction.user?.id;
  await sendTicketCommandLog(env, channel.id, `Ticket renomme en **${name}** par <@${actorId}>.`);
  return name;
}

function normalizeTicketOptions(options) {
  const src = Array.isArray(options) && options.length ? options : TICKET_OPTIONS;
  return src
    .filter(o => o && o.label)
    .slice(0, 25)
    .map((o, i) => ({
      key: ticketSafeName(o.key || o.label || `ticket-${i + 1}`),
      emoji: String(o.emoji || "\ud83c\udfab").slice(0, 8),
      label: String(o.label || `Ticket ${i + 1}`).slice(0, 80),
      roleIds: ticketAccessRoleIds(o),
      roleId: ticketAccessRoleIds(o)[0] || "",
      mentionRoleIds: ticketMentionRoleIds(o),
      categoryId: String(o.categoryId || o.category_id || "").replace(/\D/g, ""),
      channelPrefix: ticketSafeName(o.channelPrefix || o.channel_prefix || ""),
      description: String(o.description || (o.unavailable ? "Pas disponible" : "Ouvrir une liaison privée")).slice(0, 100),
      unavailable: !!o.unavailable
    }));
}

function findTicketOption(key) {
  const options = normalizeTicketOptions([...TICKET_OPTIONS, ...TICKET_ACADEMY_PANEL_OPTIONS]);
  return options.find(o => o.key === key);
}

function buildAcademyTicketPanelConfig(config = {}) {
  return {
    ...config,
    panel_key: "academy",
    title: "Contact SASP",
    logo_url: TICKET_PANEL_LOGO_URL,
    image_url: TICKET_PANEL_IMAGE_URL,
    footer: TICKET_FOOTER_TEXT,
    placeholder: "Fais un choix",
    options: TICKET_ACADEMY_PANEL_OPTIONS,
    description: [
      "Bienvenue sur le centre de contact officiel du San Andreas State Police.",
      "",
      "Sélectionnez le service correspondant à votre demande.",
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      "\ud83c\udfdb\ufe0f **Etat-Major**",
      "*Pour toute demande officielle ou administrative concernant le Command Staff.*",
      "",
      "\ud83c\udf93 **Police Academy**",
      "*Pour toute question relative au recrutement, aux formations ou aux candidatures.*",
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      "\u26a0\ufe0f Merci de n'ouvrir qu'un seul ticket par demande afin de faciliter son traitement.",
      "",
      "• Le San Andreas State Police vous remercie de votre confiance."
    ].join("\n")
  };
}

function buildTicketPanelPayload(config = {}) {
  const categoryId = String(config.category_id || config.categoryId || TICKET_DEFAULT_CATEGORY_ID).replace(/\D/g, "");
  const options = normalizeTicketOptions(config.options);
  const panelKey = ticketSafeName(config.panel_key || config.panelKey || "");
  return {
    embeds: [{
      author: {
        name: config.title || "Contact Division / Unité",
        icon_url: config.logo_url || config.logoUrl || TICKET_PANEL_LOGO_URL
      },
      description: config.description || [
        "Vous trouverez ci-dessous les contacts des unités / divisions.",
        "",
        ...options.map(o => `- ${o.emoji} **${o.label}**${o.unavailable ? " *(Pas disponible)*" : ""}`),
        "",
        "Sélectionnez une entrée dans le menu pour ouvrir une liaison privée."
      ].join("\n"),
      color: TICKET_PANEL_ACCENT_COLOR,
      image: config.image_url || config.imageUrl ? { url: config.image_url || config.imageUrl } : { url: TICKET_PANEL_IMAGE_URL },
      footer: { text: config.footer || TICKET_FOOTER_TEXT }
    }],
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: `ticket_open_select|${categoryId}|${panelKey}`.slice(0, 100),
        placeholder: config.placeholder || "Fais un choix",
        min_values: 1,
        max_values: 1,
        options: options.map(o => ({
          label: o.label,
          value: `${o.key}|${o.categoryId || categoryId}`.slice(0, 100),
          description: o.description,
          emoji: { name: o.emoji }
        }))
      }]
    }]
  };
}

async function resetTicketPanelMessage(env, interaction, panelConfig) {
  const channelId = interaction.channel_id;
  const messageId = interaction.message?.id;
  if (!channelId || !messageId) return;
  const payload = buildTicketPanelPayload(panelConfig);
  await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

async function sendTicketPanel(env, channelId, config = {}) {
  const payload = buildTicketPanelPayload(config);
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Envoi panneau ticket impossible (${res.status}) ${err}`);
  }
  return res.json();
}

async function createTicketChannel(env, interaction, categoryId, selectedKey) {
  const option = findTicketOption(selectedKey);
  if (!option) throw new Error("Choix ticket introuvable.");
  if (option.unavailable) return { unavailable: true, label: option.label };

  const VIEW = 1024n;
  const SEND = 2048n;
  const READ_HISTORY = 65536n;
  const ATTACH = 32768n;
  const EMBED = 16384n;
  const MANAGE_CHANNELS = 16n;
  const BASE = String(VIEW | SEND | READ_HISTORY | ATTACH | EMBED);
  const STAFF = String(VIEW | SEND | READ_HISTORY | ATTACH | EMBED | MANAGE_CHANNELS);
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) throw new Error("Utilisateur introuvable.");

  const staffRoles = Array.from(new Set([...ADMIN_ROLE_IDS, ...STAFF_ROLE_IDS]));
  const optionRoleIds = ticketAccessRoleIds(option);
  const permissionOverwrites = [
    { id: interaction.guild_id, type: 0, deny: String(VIEW) },
    { id: userId, type: 1, allow: BASE },
    ...staffRoles.map(roleId => ({ id: roleId, type: 0, allow: STAFF }))
  ];
  for (const roleId of optionRoleIds) {
    if (!staffRoles.includes(roleId)) permissionOverwrites.push({ id: roleId, type: 0, allow: STAFF });
  }

  const identity = await getAgentIdentityForInteraction(env, interaction);
  const rpName = `${identity.prenom || ""} ${identity.nom || ""}`.trim()
    || ticketDisplayName(interaction)
    || userId.slice(-4);
  const channelName = ticketBuildChannelName(option.channelPrefix, rpName, interaction, userId);
  const targetCategoryId = option.categoryId || categoryId || TICKET_DEFAULT_CATEGORY_ID;
  const createRes = await discordFetch(`${DISCORD_API}/guilds/${interaction.guild_id}/channels`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: channelName,
      type: 0,
      parent_id: targetCategoryId,
      topic: `Ticket ${option.label} - demandeur ${userId}`,
      permission_overwrites: permissionOverwrites
    })
  });
  if (!createRes.ok) {
    const err = await createRes.text().catch(() => "");
    throw new Error(`Creation ticket impossible (${createRes.status}) ${err}`);
  }
  const channel = await createRes.json();

  const uniqueMentionRoleIds = ticketMentionRoleIds(option);
  const roleLine = uniqueMentionRoleIds.length ? `\n${uniqueMentionRoleIds.map(roleId => `<@&${roleId}>`).join(" ")}` : "";
  const closeRoleToken = ticketRoleToken(uniqueMentionRoleIds);
  const msgRes = await discordFetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: `Bonjour <@${userId}>,${roleLine}`,
      embeds: [{
        title: `${option.emoji} Ticket ${option.label}`,
        description: [
          `Un membre de **${option.label}** reviendra vers vous dans les plus brefs délais.`,
          "",
          "Expliquez clairement votre demande, ajoutez les captures ou documents utiles, puis attendez une réponse du service concerné."
        ].join("\n"),
        color: 0x2ecc71,
        fields: [
          { name: "Demandeur", value: `<@${userId}>`, inline: true },
          { name: "Service", value: `${option.emoji} ${option.label}`, inline: true },
          { name: "Statut", value: "Ouvert", inline: true }
        ],
        footer: { text: TICKET_FOOTER_TEXT },
        timestamp: new Date().toISOString()
      }],
      components: [{
        type: 1,
        components: [{ type: 2, style: 4, label: "Fermer le ticket", emoji: { name: "\ud83d\udd12" }, custom_id: `ticket_close|${userId}|${closeRoleToken}`.slice(0, 100) }]
      }],
      allowed_mentions: { users: [userId], roles: uniqueMentionRoleIds, parse: [] }
    })
  });
  if (!msgRes.ok) {
    const err = await msgRes.text().catch(() => "");
    throw new Error(`Message ticket impossible (${msgRes.status}) ${err}`);
  }
  return { channel_id: channel.id, label: option.label };
}

function ticketIdList(value) {
  if (Array.isArray(value)) return value.map(v => String(v || "").replace(/\D/g, "")).filter(Boolean);
  if (typeof value === "string") return value.split(/[\s,;]+/).map(v => v.replace(/\D/g, "")).filter(Boolean);
  return [];
}

function ticketFirstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function ticketChunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function ticketDiscordOption(option) {
  return {
    label: String(option.label || option.key || "Ticket").slice(0, 100),
    value: String(option.id).slice(0, 100),
    description: String(option.description || "Ouvrir un ticket").slice(0, 100),
    emoji: option.emoji ? { name: String(option.emoji).slice(0, 12) } : undefined
  };
}

function ticketDiscordButton(panel, option) {
  return {
    type: 2,
    style: Number(option.button_style || 2),
    label: String(option.label || option.key || "Ticket").slice(0, 80),
    emoji: option.emoji ? { name: String(option.emoji).slice(0, 12) } : undefined,
    custom_id: `ticket_open_button_db|${panel.id}|${option.id}`.slice(0, 100),
    disabled: option.enabled === false
  };
}

function ticketPanelEmbed(panel, options) {
  const description = panel.description || [
    "Selectionnez le service ou la division a contacter.",
    "Un salon prive sera ouvert automatiquement avec les personnes autorisees.",
    "",
    ...options.map(o => `${o.emoji || "🎫"} **${o.label}**${o.description ? ` - ${o.description}` : ""}`)
  ].join("\n");
  const embed = {
    title: panel.title || "🎫 Centre de tickets",
    description: String(description).slice(0, 4096),
    color: Number(panel.color || 0xd4af37),
    footer: { text: panel.footer || "SASP - Ticketing" },
    timestamp: new Date().toISOString()
  };
  if (panel.image_url) embed.image = { url: panel.image_url };
  if (panel.thumbnail_url) embed.thumbnail = { url: panel.thumbnail_url };
  if (panel.author_name) embed.author = { name: panel.author_name, icon_url: panel.author_icon_url || undefined };
  return embed;
}

function buildTicketPanelPayloadFromDb(panel, options) {
  const activeOptions = options.filter(o => o.enabled !== false).slice(0, 25);
  const components = [];
  if (panel.component_type === "buttons") {
    for (const chunk of ticketChunks(activeOptions, 5)) {
      components.push({ type: 1, components: chunk.map(o => ticketDiscordButton(panel, o)) });
    }
  } else {
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `ticket_open_db|${panel.id}`.slice(0, 100),
        placeholder: panel.placeholder || "Fais un choix",
        min_values: 1,
        max_values: 1,
        options: activeOptions.map(ticketDiscordOption)
      }]
    });
  }
  return {
    content: panel.content || undefined,
    embeds: [ticketPanelEmbed(panel, activeOptions)],
    components,
    allowed_mentions: { parse: [] }
  };
}

async function getTicketPanelDb(env, panelId, guildId) {
  const siteKey = siteKeyFromGuildId(guildId);
  const panelRows = await sbForSite(env, "GET", `/ticket_panels?id=eq.${encodeURIComponent(panelId)}&guild_id=eq.${String(guildId).replace(/\D/g, "")}&select=*&limit=1`, null, siteKey);
  const panel = ticketFirstRow(panelRows);
  if (!panel) throw new Error("Panel ticket introuvable.");
  if (panel.enabled === false) throw new Error("Ce panel ticket est desactive.");
  const optionRows = await sbForSite(env, "GET", `/ticket_options?panel_id=eq.${encodeURIComponent(panel.id)}&select=*&order=position.asc`, null, siteKey);
  return { panel, options: optionRows || [], siteKey };
}

async function publishTicketPanelFromDb(env, panelId, guildId) {
  const { panel, options, siteKey } = await getTicketPanelDb(env, panelId, guildId);
  const channelId = String(panel.channel_id || TICKET_DEFAULT_PANEL_CHANNEL_ID).replace(/\D/g, "");
  if (!channelId) throw new Error("Salon du panel manquant.");
  const payload = buildTicketPanelPayloadFromDb(panel, options);
  let message = null;
  if (panel.message_id) {
    const patch = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${panel.message_id}`, {
      method: "PATCH",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (patch.ok) message = await patch.json();
  }
  if (!message) {
    const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Envoi panneau impossible (${res.status}) ${await res.text().catch(() => "")}`);
    message = await res.json();
  }
  await sbForSite(env, "PATCH", `/ticket_panels?id=eq.${encodeURIComponent(panel.id)}`, {
    message_id: message.id,
    updated_at: new Date().toISOString()
  }, siteKey);
  return { panel_id: panel.id, channel_id: channelId, message_id: message.id };
}

function ticketDisplayName(interaction) {
  const user = interaction.member?.user || interaction.user || {};
  return user.global_name || user.username || user.id || "utilisateur";
}

function ticketFormatChannelName(format, panel, option, interaction, number) {
  const userId = interaction.member?.user?.id || interaction.user?.id || "";
  const username = ticketDisplayName(interaction);
  const date = new Date().toISOString().slice(0, 10);
  return ticketSafeName(String(format || "ticket-{number}-{option}")
    .replaceAll("{number}", String(number || "0001").padStart(4, "0"))
    .replaceAll("{username}", username)
    .replaceAll("{displayName}", username)
    .replaceAll("{user}", username)
    .replaceAll("{userId}", userId)
    .replaceAll("{option}", option.key || option.label || "ticket")
    .replaceAll("{panel}", panel.name || "panel")
    .replaceAll("{date}", date)).slice(0, 95);
}

function ticketPermissionOverwrites(interaction, option) {
  const VIEW = 1024n;
  const SEND = 2048n;
  const READ_HISTORY = 65536n;
  const ATTACH = 32768n;
  const EMBED = 16384n;
  const MANAGE_CHANNELS = 16n;
  const BASE = String(VIEW | SEND | READ_HISTORY | ATTACH | EMBED);
  const STAFF = String(VIEW | SEND | READ_HISTORY | ATTACH | EMBED | MANAGE_CHANNELS);
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const staffRoles = Array.from(new Set([
    ...ADMIN_ROLE_IDS,
    ...STAFF_ROLE_IDS,
    ...ticketAccessRoleIds(option)
  ]));
  return [
    { id: interaction.guild_id, type: 0, deny: String(VIEW) },
    { id: userId, type: 1, allow: BASE },
    ...staffRoles.map(roleId => ({ id: roleId, type: 0, allow: STAFF }))
  ];
}

function memberHasAnyRole(member, roles) {
  const memberRoles = member?.roles || [];
  return ticketIdList(roles).some(roleId => memberRoles.includes(roleId));
}

async function getTicketManageContext(env, siteKey, ticketId, member) {
  if (hasStaffRole(member)) return { allowed: true, ticket: null };
  if (!ticketId || String(ticketId).startsWith("channel-")) return { allowed: false, ticket: null };
  const rows = await sbForSite(env, "GET", `/ticket_tickets?id=eq.${encodeURIComponent(ticketId)}&select=id,requester_id,option_id,panel_id,channel_id,status&limit=1`, null, siteKey).catch(() => []);
  const ticket = Array.isArray(rows) ? rows[0] : null;
  if (!ticket?.option_id) return { allowed: false, ticket };
  const options = await sbForSite(env, "GET", `/ticket_options?id=eq.${encodeURIComponent(ticket.option_id)}&select=support_role_ids,manager_role_ids&limit=1`, null, siteKey).catch(() => []);
  const option = Array.isArray(options) ? options[0] : null;
  const allowedRoles = ticketAccessRoleIds(option);
  return { allowed: memberHasAnyRole(member, allowedRoles), ticket };
}

async function insertTicketLogDb(env, siteKey, ticketId, guildId, action, executorId, metadata = {}) {
  try {
    await sbForSite(env, "POST", "/ticket_logs", {
      ticket_id: ticketId || null,
      guild_id: guildId,
      action,
      actor_id: executorId || null,
      details: metadata
    }, siteKey);
  } catch (e) {
    console.warn("ticket log db failed", e && e.message);
  }
}

async function sendTicketLogDiscord(env, channelId, title, description, color = 0xd4af37) {
  if (!channelId) return;
  try {
    await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{ title, description, color, timestamp: new Date().toISOString(), footer: { text: "SASP - Ticketing logs" } }],
        allowed_mentions: { parse: [] }
      })
    });
  } catch (e) {
    console.warn("ticket log discord failed", e && e.message);
  }
}

async function createTicketChannelFromDb(env, interaction, panelId, optionId) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) throw new Error("Utilisateur introuvable.");
  const { panel, options, siteKey } = await getTicketPanelDb(env, panelId, interaction.guild_id);
  const option = options.find(o => String(o.id) === String(optionId));
  if (!option) throw new Error("Option ticket introuvable.");
  if (option.enabled === false) throw new Error("Cette option n'est pas disponible.");
  if (memberHasAnyRole(interaction.member, option.blocked_role_ids)) throw new Error("Tu n'as pas acces a cette option.");
  const required = ticketIdList(option.required_role_ids);
  if (required.length && !memberHasAnyRole(interaction.member, required)) throw new Error("Tu n'as pas le role requis pour cette option.");

  const existing = await sbForSite(env, "GET", `/ticket_tickets?guild_id=eq.${interaction.guild_id}&requester_id=eq.${userId}&option_id=eq.${encodeURIComponent(option.id)}&status=in.(open,claimed)&select=id,channel_id,status&limit=5`, null, siteKey);
  const maxOpen = Number(option.max_tickets_per_user || panel.max_tickets_per_user || 1);
  if (Array.isArray(existing) && existing.length >= maxOpen) {
    return { limited: true, channel_id: existing[0]?.channel_id };
  }

  const countRows = await sbForSite(env, "GET", `/ticket_tickets?guild_id=eq.${interaction.guild_id}&select=id`, null, siteKey).catch(() => []);
  const ticketNumber = (Array.isArray(countRows) ? countRows.length : 0) + 1;
  const categoryId = String(option.category_id || panel.default_category_id || TICKET_DEFAULT_CATEGORY_ID).replace(/\D/g, "");
  const channelName = ticketFormatChannelName(option.channel_name_format, panel, option, interaction, ticketNumber);
  const createRes = await discordFetch(`${DISCORD_API}/guilds/${interaction.guild_id}/channels`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: channelName,
      type: 0,
      parent_id: categoryId || undefined,
      topic: `Ticket ${ticketNumber} - ${option.label} - demandeur ${userId}`,
      permission_overwrites: ticketPermissionOverwrites(interaction, option)
    })
  });
  if (!createRes.ok) throw new Error(`Creation ticket impossible (${createRes.status}) ${await createRes.text().catch(() => "")}`);
  const channel = await createRes.json();

  const insertRows = await sbForSite(env, "POST", "/ticket_tickets", {
    guild_id: interaction.guild_id,
    panel_id: panel.id,
    option_id: option.id,
    channel_id: channel.id,
    ticket_number: ticketNumber,
    requester_id: userId,
    requester_name: ticketDisplayName(interaction),
    status: "open",
    opened_at: new Date().toISOString()
  }, siteKey).catch(() => null);
  const ticket = ticketFirstRow(insertRows) || { id: `channel-${channel.id}` };
  const mentionRoles = ticketMentionRoleIds(option);
  const roleLine = mentionRoles.map(id => `<@&${id}>`).join(" ");
  const welcome = option.welcome_message || "Expliquez clairement votre demande, ajoutez les captures ou documents utiles, puis attendez une reponse du service concerne.";
  await discordFetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: [`Bonjour <@${userId}>`, roleLine].filter(Boolean).join("\n"),
      embeds: [{
        title: `${option.emoji || "🎫"} Ticket ${option.label || "SASP"}`,
        description: welcome,
        color: Number(option.welcome_color || panel.color || 0xd4af37),
        fields: [
          { name: "Demandeur", value: `<@${userId}>`, inline: true },
          { name: "Panel", value: panel.name || "Tickets", inline: true },
          { name: "Numero", value: `#${String(ticketNumber).padStart(4, "0")}`, inline: true }
        ],
        footer: { text: panel.footer || "SASP - Ticketing" },
        timestamp: new Date().toISOString()
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 3, label: "Prendre en charge", emoji: { name: "✅" }, custom_id: `ticket_claim_db|${ticket.id}`.slice(0, 100) },
          { type: 2, style: 4, label: "Fermer", emoji: { name: "🔒" }, custom_id: `ticket_close_db|${ticket.id}|${userId}`.slice(0, 100) }
        ]
      }],
      allowed_mentions: { users: [userId], roles: mentionRoles, parse: [] }
    })
  });
  await insertTicketLogDb(env, siteKey, ticket.id, interaction.guild_id, "opened", userId, { channel_id: channel.id, option: option.label });
  await sendTicketLogDiscord(env, option.log_channel_id || panel.log_channel_id, "Ticket ouvert", `<@${userId}> a ouvert <#${channel.id}> pour **${option.label}**.`, 0x2ecc71);
  return { channel_id: channel.id, ticket_id: ticket.id, label: option.label };
}

async function claimTicketDb(env, interaction, ticketId) {
  const siteKey = siteKeyFromGuildId(interaction.guild_id);
  const member = interaction.member || {};
  const manageContext = await getTicketManageContext(env, siteKey, ticketId, member);
  if (!manageContext.allowed) throw new Error("Action reservee au staff du ticket.");
  const userId = member.user?.id || interaction.user?.id;
  if (!String(ticketId).startsWith("channel-")) {
    await sbForSite(env, "PATCH", `/ticket_tickets?id=eq.${encodeURIComponent(ticketId)}`, {
      status: "claimed",
      claimed_by: userId,
      claimed_at: new Date().toISOString()
    }, siteKey);
  }
  await insertTicketLogDb(env, siteKey, ticketId, interaction.guild_id, "claimed", userId, { channel_id: interaction.channel_id });
}

async function closeTicketDb(env, interaction, ticketId, requesterId) {
  const siteKey = siteKeyFromGuildId(interaction.guild_id);
  const member = interaction.member || {};
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const manageContext = await getTicketManageContext(env, siteKey, ticketId, member);
  const requester = manageContext.ticket?.requester_id || requesterId;
  if (userId !== requester && !manageContext.allowed) throw new Error("Tu n'as pas l'autorisation de fermer ce ticket.");
  if (!String(ticketId).startsWith("channel-")) {
    await sbForSite(env, "PATCH", `/ticket_tickets?id=eq.${encodeURIComponent(ticketId)}`, {
      status: "closed",
      closed_by: userId,
      closed_at: new Date().toISOString()
    }, siteKey).catch(() => null);
  }
  await insertTicketLogDb(env, siteKey, ticketId, interaction.guild_id, "closed", userId, { channel_id: interaction.channel_id });
  await new Promise(resolve => setTimeout(resolve, 1200));
  await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}`, {
    method: "DELETE",
    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
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

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type, x-log-token",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS"
        }
      });
    }

    if (url.pathname === "/admin/backup-site" && request.method === "GET") {
      const token = request.headers.get("x-log-token") || url.searchParams.get("token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const siteKey = url.searchParams.get("site") === "nord" ? "nord" : "sud";
      try {
        return json(await exportSiteBackup(env, siteKey));
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/test-pointeuse-dm" && request.method === "GET") {
      const token = request.headers.get("x-log-token") || url.searchParams.get("token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ ok: false, error: "user_id requis" }, 400);
      const result = await sendUserDM(env, userId, {
        embeds: [{
          title: "\u23f1\ufe0f Test notification pointeuse",
          description: "Test MP SASP : si tu vois ce message, la notification priv\u00e9e d'auto-d\u00e9connexion apr\u00e8s 6h fonctionne.",
          color: 0xe67e22,
          footer: { text: "SASP \u00b7 Pointeuse" },
          timestamp: new Date().toISOString()
        }]
      });
      return json(result, result.ok ? 200 : 500);
    }

    if (url.pathname === "/admin/test-pointeuse-confirmation" && request.method === "GET") {
      const token = request.headers.get("x-log-token") || url.searchParams.get("token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const userId = url.searchParams.get("user_id");
      if (!userId) return json({ ok: false, error: "user_id requis" }, 400);
      const siteKey = url.searchParams.get("site") === "nord" ? "nord" : "sud";
      try {
        const result = await testPointeuseConfirmationForUser(env, userId, siteKey);
        return json(result, result.ok ? 200 : 400);
      } catch (e) {
        return json({ ok: false, error: e.message || String(e) }, 500);
      }
    }

    // Sync divisions intranet â†’ Discord
    if (url.pathname === "/admin/enterprise-invite-url" && request.method === "GET") {
      const appId = env.DISCORD_APPLICATION_ID;
      if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
      const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=8&integration_type=0&scope=bot+applications.commands`;
      return json({ ok: true, invite_url: inviteUrl });
    }

    if (url.pathname === "/admin/setup-enterprises" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild") || ENTERPRISE_GUILD_ID;
        const adminRoleId = url.searchParams.get("admin_role") || ENTERPRISE_ADMIN_ROLE_ID;
        const start = Math.max(0, parseInt(url.searchParams.get("start") || "0", 10) || 0);
        const limit = Math.max(1, Math.min(5, parseInt(url.searchParams.get("limit") || "3", 10) || 3));
        const result = await setupEnterpriseDiscord(env, guildId, adminRoleId, start, limit);
        return json(result);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/setup-enterprises-general" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild") || ENTERPRISE_GUILD_ID;
        const adminRoleId = url.searchParams.get("admin_role") || ENTERPRISE_ADMIN_ROLE_ID;
        const start = Math.max(0, parseInt(url.searchParams.get("start") || "0", 10) || 0);
        const limit = Math.max(1, Math.min(5, parseInt(url.searchParams.get("limit") || "3", 10) || 3));
        const result = await setupEnterpriseGeneral(env, guildId, adminRoleId, start, limit);
        return json(result);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/setup-public-services" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild") || ENTERPRISE_GUILD_ID;
        const result = await setupPublicServiceCategories(env, guildId);
        return json(result);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/copy-swat-channels" && request.method === "GET") {
      try {
        const sourceGuildId = url.searchParams.get("source") || "1382167184607940658";
        const targetGuildId = url.searchParams.get("target") || "1500975724750704661";
        const result = await copySwatChannels(env, sourceGuildId, targetGuildId);
        return json(result);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/cleanup-enterprises" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild") || ENTERPRISE_GUILD_ID;
        const start = Math.max(0, parseInt(url.searchParams.get("start") || "0", 10) || 0);
        const limit = Math.max(1, Math.min(5, parseInt(url.searchParams.get("limit") || "3", 10) || 3));
        const result = await cleanupEnterpriseDuplicates(env, guildId, start, limit);
        return json(result);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/sync-member-roles" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { discord_id, add_codes, remove_codes, guild_id } = await request.json();
      const guildId = guild_id || url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
      const syncableRoles = syncableRolesForGuild(guildId);
      const results = [];
      for (const code of (add_codes || [])) {
        const roleId = syncableRoles[code]; if (!roleId) continue;
        const r = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${discord_id}/roles/${roleId}`, {
          method: "PUT", headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "X-Audit-Log-Reason": "SASP Intranet â€” sync" }
        });
        results.push({ code, action: "add", status: r.status });
      }
      for (const code of (remove_codes || [])) {
        const roleId = syncableRoles[code]; if (!roleId) continue;
        const r = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${discord_id}/roles/${roleId}`, {
          method: "DELETE", headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "X-Audit-Log-Reason": "SASP Intranet â€” sync" }
        });
        results.push({ code, action: "remove", status: r.status });
      }
      return json({ ok: true, results });
    }

    // Sync divisions Discord â†’ intranet
    if (url.pathname === "/grade-role-counts" && request.method === "GET") {
      const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
      try {
        const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/roles/member-counts`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (!res.ok) throw new Error(`Discord role counts failed: ${res.status}`);
        const roleCounts = await res.json();
        return json({ ok: true, counts: countGradesFromRoleCountsForGuild(roleCounts, guildId), role_counts: roleCounts });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/ftf/convocation-notify" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      try {
        const data = await request.json();
        const dossierId = String(data.dossier_id || "").trim();
        const creatorId = String(data.creator_id || "").replace(/\D/g, "");
        const suspect = String(data.suspect || "personne inconnue").trim();
        const nextStep = String(data.next_step || "convocation").trim();
        const currentStatus = String(data.current_status || "").trim();
        const notificationType = String(data.notification_type || "warning").trim();
        const dueDate = String(data.due_date || "").trim();
        const amount = Number(data.amount || 0);
        const reason = String(data.reason || "").trim();
        const ping = creatorId ? `<@${creatorId}>` : `<@&${FTF_ROLE_ID}>`;
        const isDeadline = notificationType === "deadline";
        const title = isDeadline ? "Alerte FTF - delai expire" : "Rappel FTF - convocation demain";
        const description = isDeadline
          ? `Le delai est arrive a expiration pour **${suspect}**. Procedure attendue : **${nextStep}**.\n\nOuvre le dossier FTF, choisis la date et l'heure souhaitees, puis genere la convocation PNG.`
          : `Convocation demain pour **${suspect}** : **${nextStep}**.\n\nOuvre le dossier FTF, choisis la date et l'heure souhaitees, puis genere la convocation PNG.`;
        const fields = [
          { name: "Statut actuel", value: currentStatus || "Non precise", inline: true },
          { name: "Date limite", value: dueDate || (isDeadline ? "Aujourd'hui" : "Demain"), inline: true },
          { name: "Action attendue", value: nextStep || "A traiter", inline: true }
        ];
        if (amount > 0) fields.push({ name: "Montant actuel", value: `${amount.toLocaleString("fr-FR")} $`, inline: true });
        if (reason) fields.push({ name: "Raison de l'amende", value: reason.slice(0, 1000), inline: false });
        const res = await discordFetch(`${DISCORD_API}/channels/${FTF_NOTIFICATION_CHANNEL_ID}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `${ping} - ${isDeadline ? "delai FTF expire" : "rappel FTF, convocation demain"} : choisis la date et l'heure de convocation dans le dossier FTF.`,
            allowed_mentions: creatorId ? { users: [creatorId] } : { roles: [FTF_ROLE_ID] },
            embeds: [{
              title,
              color: isDeadline ? 0xe74c3c : 0xc9a84c,
              description,
              fields,
              footer: { text: "SASP - FTF" },
              timestamp: new Date().toISOString()
            }],
            components: dossierId ? [{
              type: 1,
              components: [
                { type: 2, style: 1, label: "Choisir date/heure", custom_id: `ftf_convocation_schedule|${dossierId}` },
                { type: 2, style: 3, label: "Marquer traité", custom_id: `ftf_convocation_done|${dossierId}` }
              ]
            }] : []
          })
        });
        if (!res.ok) return json({ ok: false, error: await res.text() }, res.status);
        await sendFtfLog(env, "Notification FTF envoyee", `Dossier ${dossierId || "sans id"} - ${suspect} - ${nextStep}`, isDeadline ? 0xe74c3c : 0xc9a84c);
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/ftf/dossiers" && request.method === "GET") {
      try {
        return json({ ok: true, dossiers: await getFtfDossiers(env) });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/ftf/dossiers" && (request.method === "POST" || request.method === "PATCH")) {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      try {
        const body = await request.json();
        const dossier = body.dossier || body;
        return json({ ok: true, dossier: await upsertFtfDossier(env, dossier) });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/ftf/dossiers/bulk" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      try {
        const body = await request.json();
        const dossiers = Array.isArray(body.dossiers) ? body.dossiers : [];
        const saved = [];
        for (const dossier of dossiers) saved.push(await upsertFtfDossier(env, dossier));
        return json({ ok: true, count: saved.length, dossiers: saved });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/ftf/dossiers" && request.method === "DELETE") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      try {
        const id = url.searchParams.get("id");
        if (!id) return json({ ok: false, error: "Missing id" }, 400);
        await sb(env, "DELETE", `/ftf_dossiers?id=eq.${encodeURIComponent(id)}`);
        return json({ ok: true, id });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/ftf/upload-photo" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        const dossierId = formData.get("dossier_id") || "unknown";
        if (!file || typeof file === "string") return json({ ok: false, error: "Fichier manquant" }, 400);
        const df = new FormData();
        df.append("file", file, file.name || "photo.png");
        df.append("payload_json", JSON.stringify({ content: `[FTF] Photo dossier ${dossierId}` }));
        const res = await fetch(`${DISCORD_API}/channels/${FTF_NOTIFICATION_CHANNEL_ID}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` },
          body: df
        });
        if (!res.ok) { const e = await res.text(); return json({ ok: false, error: `Discord ${res.status}: ${e}` }, 500); }
        const msg = await res.json();
        const att = msg.attachments?.[0];
        if (!att) return json({ ok: false, error: "Aucune pièce jointe retournée" }, 500);
        await sendFtfLog(env, "Photo FTF uploadee", `Dossier ${dossierId} - ${att.filename || "fichier"}`);
        return json({ ok: true, url: att.url, filename: att.filename });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/ftf/send-convocation" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      try {
        const data = await request.json();
        const creatorId = String(data.creator_id || "").replace(/\D/g, "");
        const suspect = String(data.suspect || "Suspect").trim();
        const convocation = String(data.convocation || "Convocation").trim();
        const date = String(data.date || "").trim();
        const heure = String(data.heure || "").trim();
        const source = String(data.source || "").trim();
        const bytes = dataUrlToBytes(data.image_data);
        const filename = `convocation-${suspect.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ftf"}.png`;
        const content = [
          creatorId ? `<@${creatorId}>` : `<@&${FTF_ROLE_ID}>`,
          `Convocation FTF generee pour **${suspect}**.`,
          convocation ? `Etape : **${convocation}**.` : "",
          date || heure ? `Rendez-vous : **${date || "date non precisee"}** a **${heure || "heure non precisee"}**.` : "",
          source ? `Service createur : **${source}**.` : ""
        ].filter(Boolean).join("\n");
        const form = new FormData();
        form.append("payload_json", JSON.stringify({
          content,
          allowed_mentions: creatorId ? { users: [creatorId] } : { roles: [FTF_ROLE_ID] }
        }));
        form.append("files[0]", new Blob([bytes], { type: "image/png" }), filename);
        const channelId = String(data.channel_id || FTF_CONVOCATION_CHANNEL_ID).replace(/\D/g, "");
        const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` },
          body: form
        });
        if (!res.ok) return json({ ok: false, error: await res.text() }, res.status);
        const posted = await res.json();
        await sendFtfLog(env, "Convocation FTF envoyee", `${suspect} - ${date || "date non precisee"} ${heure || ""} - salon ${channelId}`);
        return json({ ok: true, message_id: posted.id, channel_id: channelId });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/get-member-roles" && request.method === "GET") {
      const discordId = url.searchParams.get("discord_id");
      if (!discordId) return json({ error: "Missing discord_id" }, 400);
      const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
      const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${discordId}`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      if (!res.ok) return json({ ok: false, error: "Membre non trouvÃ©" }, 404);
      const member = await res.json();
      const roles = member.roles || [];
      const roleToDivision = roleToDivisionForGuild(guildId);
      const ppaRoles = roleConfigForGuild(guildId).ppa;
      const divisions = roles.filter(r => roleToDivision[r]).map(r => roleToDivision[r]);
      return json({
        ok: true,
        divisions,
        ppa1: !!ppaRoles.ppa1 && roles.includes(ppaRoles.ppa1),
        ppa2: !!ppaRoles.ppa2 && roles.includes(ppaRoles.ppa2),
        ppa3: (!!ppaRoles.ppa3a && roles.includes(ppaRoles.ppa3a)) || (!!ppaRoles.ppa3b && roles.includes(ppaRoles.ppa3b)),
        grade: gradeFromRolesForGuild(roles, guildId)
      });
    }

    if (url.pathname === "/discord/agents-roster" && request.method === "GET") {
      const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
      const roleIds = String(url.searchParams.get("role_ids") || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || "1000") || 1000));
      const members = [];
      let after = "0";
      try {
        while (members.length < limit) {
          const batchLimit = Math.min(1000, limit - members.length);
          const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members?limit=${batchLimit}&after=${after}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (!res.ok) {
            const errText = await res.text();
            const hint = res.status === 403
              ? "Active Server Members Intent dans le Discord Developer Portal du bot, puis reessaie."
              : "";
            return json({ ok: false, error: errText, hint, status: res.status }, res.status);
          }
          const batch = await res.json();
          if (!Array.isArray(batch) || !batch.length) break;
          members.push(...batch);
          after = batch[batch.length - 1].user?.id || after;
          if (batch.length < batchLimit) break;
        }
        const agents = members
          .filter(member => !member.user?.bot)
          .filter(member => !roleIds.length || roleIds.some(roleId => (member.roles || []).includes(roleId)))
          .map(member => {
            const parsed = parseAgentDisplayName(member.nick || member.user?.global_name || member.user?.username || "");
            if (!parsed) return null;
            return {
              ...parsed,
              discord_id: member.user.id,
              username: member.user.username || "",
              ...memberRoleInfo(member, guildId)
            };
          })
          .filter(Boolean)
          .sort((a, b) => String(a.matricule).localeCompare(String(b.matricule), "fr", { numeric: true }));
        return json({ ok: true, guild_id: guildId, count: agents.length, agents });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // RÃ©cupÃ¨re les rÃ´les de membres Discord par IDs (Discord â†’ Intranet)
    if (url.pathname === "/sync-all-from-discord" && request.method === "POST") {
      try {
        const token = request.headers.get("x-log-token");
        if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
        const { discord_ids } = await request.json();
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const map = {};
        for (const discordId of (discord_ids || [])) {
          const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${discordId}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (!res.ok) continue;
          const m = await res.json();
          const roles = m.roles || [];
          const roleToDivision = roleToDivisionForGuild(guildId);
          const ppaRoles = roleConfigForGuild(guildId).ppa;
          map[discordId] = {
            divisions: roles.filter(r => roleToDivision[r]).map(r => roleToDivision[r]),
            ppa1:  !!ppaRoles.ppa1 && roles.includes(ppaRoles.ppa1),
            ppa2:  !!ppaRoles.ppa2 && roles.includes(ppaRoles.ppa2),
            ppa3:  (!!ppaRoles.ppa3a && roles.includes(ppaRoles.ppa3a)) || (!!ppaRoles.ppa3b && roles.includes(ppaRoles.ppa3b)),
            grade: gradeFromRolesForGuild(roles, guildId)
          };
        }
        return json({ ok: true, map });
      } catch (e) {
        return json({ ok: false, error: e.message || String(e) }, 500);
      }
    }

    // Sync tous les agents intranet â†’ Discord
    if (url.pathname === "/sync-all-agents" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const payload = await request.json();
      const agents = Array.isArray(payload.agents)
        ? payload.agents
        : (payload.agents && typeof payload.agents === "object" ? Object.values(payload.agents) : []);
      const guildId = payload.guild_id || url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
      const divisionRoles = roleConfigForGuild(guildId).divisions;
      const allCodes = Object.keys(divisionRoles);
      let ok = 0, errors = 0;
      for (const ag of (agents || [])) {
        if (!ag.discord_id) continue;
        const hasDivisions = ag.divisions || [];
        for (const code of allCodes) {
          const roleId = divisionRoles[code];
          const method = hasDivisions.includes(code) ? "PUT" : "DELETE";
          const r = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${ag.discord_id}/roles/${roleId}`, {
            method, headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "X-Audit-Log-Reason": "SASP Intranet â€” sync global" }
          });
          if (r.ok || r.status === 204) ok++; else errors++;
        }
      }
      return json({ ok: true, synced: ok, errors });
    }

    // Logs intranet â†’ Discord
    // Liste agents â†’ Discord (message auto-mis Ã  jour)
    if (url.pathname === "/update-agent-list" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { agents, channel_id } = await request.json();
      const channelId = channel_id || url.searchParams.get("channel_id") || "1519818698100179094";
      const lines = (agents || [])
        .filter(a => a.telephone)
        .sort((a, b) => (a.matricule || '').localeCompare(b.matricule || ''))
        .map(a => `**${a.matricule || 'â€”'}** ${a.prenom} ${a.nom} â€” \`${a.telephone}\``);
      const description = lines.length ? lines.join('\n').slice(0, 4000) : '*Aucun agent avec un numÃ©ro de tÃ©lÃ©phone.*';
      const embed = {
        title: "ðŸ“‹ Liste des agents â€” TÃ©lÃ©phones",
        description,
        color: 0x2c3e50,
        footer: { text: `SASP Intranet â€¢ ${lines.length} agent(s) rÃ©pertoriÃ©(s)` },
        timestamp: new Date().toISOString()
      };
      const msgsRes = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=50`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const msgs = await msgsRes.json();
      const annuaireMessages = Array.isArray(msgs)
        ? msgs.filter(m => {
            const e = m.embeds?.[0] || {};
            const title = String(e.title || "");
            const footer = String(e.footer?.text || "");
            return m.author?.bot && (title.includes("Liste des agents") || footer.includes("SASP Intranet"));
          })
        : [];
      const existing = annuaireMessages[0];
      if (existing) {
        await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${existing.id}`, {
          method: "PATCH",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] })
        });
        for (const duplicate of annuaireMessages.slice(1)) {
          await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${duplicate.id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
        }
      } else {
        await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
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
        const { embed, channel_id } = await request.json();
        const channelId = channel_id || url.searchParams.get("channel_id") || "1519525957390827711";
        await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
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
      const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
      try {
        const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
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
      const siteKey = url.searchParams.get("site") || siteKeyFromGuildId(url.searchParams.get("guild_id"));
      const active = await getAllActivePointages(env, siteKey);
      const payload = buildPointeuseMessage(active);
      const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      return json({ ok: res.ok, message_id: data.id, channel_id: channelId });
    }

    // Envoyer le message sticky plainte
    const STICKY_PLAINTE_CHANNEL = "1519510826233364500";
    const STICKY_PLAINTE_EMBED = { embeds: [{ title: "ðŸ“‹ DÃ©poser une plainte", color: 0x3498db, description: "Utilisez la commande `/plainte` pour dÃ©poser une plainte officielle.\n\nUne fois le formulaire validÃ©, **copiez-collez** le message gÃ©nÃ©rÃ© et envoyez-le ici :\nhttps://discord.com/channels/1512185605805703179/1517219854724235477", footer: { text: "SASP â€¢ Service des plaintes" } }] };
    if (url.pathname === "/admin/send-sticky-plainte" && request.method === "GET") {
      const res = await discordFetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(STICKY_PLAINTE_EMBED)
      });
      const data = await res.json();
      return json({ ok: res.ok, data });
    }

    const STICKY_PROC_CHANNEL = "1521575058500489478";
    const BRACELET_COMMAND_CHANNEL = "1521575058500489478";
    const BRACELET_FORUM_CHANNEL = "1518656285074128926";
    const SUD_GUILD_ID = "1500975724750704661";
    const NORD_GUILD_ID = "1516510943318642950";
    const DOJ_GUILD_ID = "1512185605805703179";
    const NORD_COMMAND_CHANNEL = "1525236785293168772";
    const NORD_PROC_FORUM_CHANNEL = "1525237429613891644";
    const NORD_BRACELET_FORUM_CHANNEL = "1524218318599487639";
    const DOJ_PROC_FORUM_CHANNEL = "1517219788781260921";
    const DOJ_BRACELET_FORUM_CHANNEL = "1525238418097967176";
    const SUBVENTION_CHANNEL = "1523726862075953353";
    const STICKY_PROC_EMBED = { embeds: [{ title: "âš–ï¸ Procureur & bracelet", color: 0x2c3e50, description: "**Commandes disponibles dans ce salon :**\n\nâ€¢ `/proc` â€” crÃ©er une demande procureur. Le bot crÃ©e automatiquement un dossier forum avec l'origine **SASP NORD** ou **SASP SUD**, et une copie est transmise au DOJ.\n\n**Champs demandÃ©s par `/proc` :**\nâ€¢ Nom PrÃ©nom du suspect\nâ€¢ ID du rapport d'arrestation\nâ€¢ Chef(s) d'accusation\nâ€¢ Heure/date de l'interpellation\nâ€¢ TÃ©lÃ©phone du suspect\n\nDans le dossier procureur :\nâ€¢ AprÃ¨s crÃ©ation du dossier, ajoutez obligatoirement un **screen du rapport** ou un **copier-coller du rapport** directement dans le forum.\nâ€¢ **Ajouter avocat** â€” ajoute l'avocat et son numÃ©ro dans le message principal, puis synchronise les copies Nord/Sud/DOJ.\nâ€¢ **Bracelet Ã‰lectronique** â€” crÃ©e un dossier bracelet liÃ© au dossier procureur.\nâ€¢ **Affaire clÃ´turÃ©e** â€” ferme le dossier procureur. Si un bracelet est liÃ©, le bot demande confirmation du retrait avant de fermer le dossier bracelet.\n\nâ€¢ `/bracelet` â€” crÃ©er uniquement un bracelet Ã©lectronique, sans ouvrir de dossier procureur.", footer: { text: "SASP â€¢ Service judiciaire" } }] };
    async function refreshProcSticky(channelId = STICKY_PROC_CHANNEL) {
      const msgsRes = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=20`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const msgs = await msgsRes.json();
      const sticky = Array.isArray(msgs) && msgs.find(m => ["âš–ï¸ Demande de procureur", "âš–ï¸ Procureur & bracelet"].includes(m.embeds?.[0]?.title));
      if (sticky) {
        await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${sticky.id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
      }
      return discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(STICKY_PROC_EMBED)
      });
    }

    function getSaspOrigin(interaction) {
      const guildId = interaction.guild_id || "";
      const channelId = interaction.channel_id || "";
      if (guildId === NORD_GUILD_ID || channelId === NORD_COMMAND_CHANNEL) {
        return { key: "nord", label: "SASP NORD", command: NORD_COMMAND_CHANNEL, procForum: NORD_PROC_FORUM_CHANNEL, braceletForum: NORD_BRACELET_FORUM_CHANNEL };
      }
      return { key: "sud", label: "SASP SUD", command: BRACELET_COMMAND_CHANNEL, procForum: "1521565049729187961", braceletForum: BRACELET_FORUM_CHANNEL };
    }

    function getProcDestinations(interaction) {
      const origin = getSaspOrigin(interaction);
      return [
        origin,
        { key: "doj", label: "DOJ", procForum: DOJ_PROC_FORUM_CHANNEL, braceletForum: DOJ_BRACELET_FORUM_CHANNEL }
      ];
    }

    function getBraceletDestinations() {
      return [
        { key: "sud", label: "SASP SUD", braceletForum: BRACELET_FORUM_CHANNEL },
        { key: "nord", label: "SASP NORD", braceletForum: NORD_BRACELET_FORUM_CHANNEL },
        { key: "doj", label: "DOJ", braceletForum: DOJ_BRACELET_FORUM_CHANNEL }
      ];
    }

    const ORIGIN_FORUM_TAGS = ["SASP NORD", "SASP SUD"];

    async function createForumThread(channelId, name, message, appliedTagIds = []) {
      const payload = { name: String(name || "Dossier").slice(0, 100), message };
      if (appliedTagIds.length) payload.applied_tags = appliedTagIds;
      const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/threads`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) throw new Error(`${channelId} (${res.status}) ${text}`);
      return data;
    }

    async function getForumChannel(channelId) {
      const res = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) throw new Error(`${channelId} (${res.status}) ${text}`);
      return data;
    }

    function normalizeForumTag(tag) {
      return {
        name: tag.name,
        moderated: !!tag.moderated,
        emoji_id: tag.emoji_id || null,
        emoji_name: tag.emoji_name || null
      };
    }

    async function addMissingForumTags(sourceChannelId, targetChannelId) {
      const source = await getForumChannel(sourceChannelId);
      const target = await getForumChannel(targetChannelId);
      const existingNames = new Set((target.available_tags || []).map(t => String(t.name || "").toLowerCase()));
      const additions = (source.available_tags || [])
        .filter(t => t.name && !existingNames.has(String(t.name).toLowerCase()))
        .map(normalizeForumTag);
      if (!additions.length) return { target: targetChannelId, added: 0 };
      const merged = (target.available_tags || []).map(normalizeForumTag).concat(additions).slice(0, 20);
      const res = await discordFetch(`${DISCORD_API}/channels/${targetChannelId}`, {
        method: "PATCH",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ available_tags: merged })
      });
      if (!res.ok) throw new Error(`${targetChannelId} (${res.status}) ${await res.text()}`);
      return { target: targetChannelId, added: additions.length };
    }

    async function ensureForumTags(channelId, tagNames) {
      const channel = await getForumChannel(channelId);
      const availableTags = (channel.available_tags || []).map(normalizeForumTag);
      const existingByName = new Map(availableTags.map(tag => [String(tag.name || "").toLowerCase(), tag]));
      const missing = tagNames
        .filter(name => name && !existingByName.has(String(name).toLowerCase()))
        .map(name => ({ name, moderated: false, emoji_id: null, emoji_name: null }));

      let nextTags = availableTags;
      if (missing.length) {
        if (availableTags.length + missing.length > 20) {
          throw new Error(`${channelId} ne peut pas recevoir les tags ${missing.map(t => t.name).join(", ")} : limite Discord de 20 tags atteinte`);
        }
        nextTags = availableTags.concat(missing);
        const res = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
          method: "PATCH",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ available_tags: nextTags })
        });
        if (!res.ok) throw new Error(`${channelId} (${res.status}) ${await res.text()}`);
      }

      const refreshed = missing.length ? await getForumChannel(channelId) : channel;
      return (refreshed.available_tags || [])
        .filter(tag => tagNames.some(name => String(tag.name || "").toLowerCase() === String(name).toLowerCase()))
        .map(tag => tag.id)
        .filter(Boolean);
    }

    function extractLineValue(content, labelPattern) {
      const match = content.match(new RegExp(labelPattern + "\\s*:\\s*([^\\n]+)", "i"));
      return match ? match[1].trim() : "";
    }

    function withProcLawyer(content, avocat, telAvocat) {
      const lawyerBlock = `**Avocat en charge de l'affaire :** ${avocat}\n\n**Num\u00e9ro de tel. de l'avocat:** ${telAvocat}\n\n`;
      const withoutOldLawyer = String(content || "").replace(/\n*\*\*Avocat en charge de l'affaire :\*\*[\s\S]*?\*\*Num(?:e|é)ro de tel\. de l'avocat:\*\*[^\n]*(?:\n\n)?/i, "\n");
      return withoutOldLawyer.replace(
        /(\*\*Num(?:e|é)ros de tel\. du suspect :\*\*[^\n]*\n\n)/i,
        `$1${lawyerBlock}`
      );
    }

    async function updateProcLawyerInThread(threadId, avocat, telAvocat) {
      const messagesRes = await discordFetch(`${DISCORD_API}/channels/${threadId}/messages?limit=20`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const messagesText = await messagesRes.text();
      let messages = [];
      try { messages = messagesText ? JSON.parse(messagesText) : []; } catch {}
      if (!messagesRes.ok) throw new Error(`${threadId} messages (${messagesRes.status}) ${messagesText}`);
      const procMsg = Array.isArray(messages)
        ? messages.find(m => String(m.content || "").includes("Nous sollicitons l'intervention d'un procureur"))
        : null;
      if (!procMsg) return false;
      const patchedContent = withProcLawyer(procMsg.content, avocat, telAvocat);
      const res = await discordFetch(`${DISCORD_API}/channels/${threadId}/messages/${procMsg.id}`, {
        method: "PATCH",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: patchedContent })
      });
      if (!res.ok) throw new Error(`${threadId} patch (${res.status}) ${await res.text()}`);
      return true;
    }

    async function findActiveProcCopies(threadName) {
      const forums = new Set(["1521565049729187961", NORD_PROC_FORUM_CHANNEL, DOJ_PROC_FORUM_CHANNEL]);
      const guilds = [SUD_GUILD_ID, NORD_GUILD_ID, DOJ_GUILD_ID];
      const threadIds = new Set();
      for (const guildId of guilds) {
        try {
          const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/threads/active`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (!res.ok) continue;
          const data = await res.json();
          for (const thread of (data.threads || [])) {
            if (thread.name === threadName && forums.has(thread.parent_id)) threadIds.add(thread.id);
          }
        } catch {}
      }
      return [...threadIds];
    }

    async function closeDiscordThread(threadId) {
      const res = await discordFetch(`${DISCORD_API}/channels/${threadId}`, {
        method: "PATCH",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true, locked: true })
      });
      if (!res.ok) throw new Error(`${threadId} close (${res.status}) ${await res.text()}`);
    }

    function parseBraceletMessage(content, thread) {
      const text = String(content || "");
      const suspectMatch = text.match(/BRACELET ELECTRONIQUE DE\s+([^\n]+)/i);
      const origin = extractLineValue(text, "Origine") || "";
      return {
        suspect: suspectMatch ? suspectMatch[1].trim() : (thread.name || "Inconnu"),
        origin,
        date: extractLineValue(text, "Pos(?:e|é) le") || "Non precisee",
        tel: extractLineValue(text, "Num(?:e|é)ro de t(?:e|é)l(?:e|é)phone") || "Non precise",
        raison: extractLineValue(text, "Raison") || "Non precisee",
        proc_thread_id: (text.match(/Dossier proc li(?:e|é)\s*:\s*<#(\d+)>/i) || [])[1] || "",
        thread_id: thread.id
      };
    }

    function normalizeBraceletName(value) {
      return String(value || "")
        .replace(/\[[^\]]+\]/g, " ")
        .replace(/\|.*$/g, " ")
        .replace(/bracelet electronique de/ig, " ")
        .replace(/bracelet électronique de/ig, " ")
        .replace(/bracelet de/ig, " ")
        .replace(/bracelet/ig, " ")
        .replace(/sasp\s+(sud|nord)/ig, " ")
        .replace(/[^a-z0-9]+/ig, " ")
        .trim()
        .replace(/\s+/g, " ")
        .toUpperCase();
    }

    function normalizeBraceletContent(content, sourceLabel) {
      let text = String(content || "");
      if (text.toUpperCase().includes("BRACELET ELECTRONIQUE DE") && !/^Origine\s*:/im.test(text)) {
        text = text.replace(/(BRACELET ELECTRONIQUE DE[^\n]*\n\n?)/i, `$1Origine : ${sourceLabel}\n`);
      }
      return text;
    }

    function braceletTitle(sourceLabel, suspect) {
      return `[${sourceLabel}] ${String(suspect || "Inconnu").trim()}`.slice(0, 100);
    }

    async function getThreadMessages(threadId) {
      const messagesRes = await discordFetch(`${DISCORD_API}/channels/${threadId}/messages?limit=50`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      if (!messagesRes.ok) {
        await discordFetch(`${DISCORD_API}/channels/${threadId}/thread-members/@me`, {
          method: "PUT",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const retryRes = await discordFetch(`${DISCORD_API}/channels/${threadId}/messages?limit=50`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (!retryRes.ok) return [];
        const retryMessages = await retryRes.json();
        return Array.isArray(retryMessages) ? retryMessages.slice().reverse() : [];
      }
      const messages = await messagesRes.json();
      return Array.isArray(messages) ? messages.slice().reverse() : [];
    }

    function isUsefulThreadMessage(message) {
      const text = String(message.content || "");
      return (
        text.trim() ||
        (message.attachments || []).length ||
        (message.embeds || []).length ||
        (message.components || []).length
      ) && !message.system;
    }

    async function getActiveForumThreads(guildId, forumId) {
      const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/threads/active`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) throw new Error(`${guildId} active threads (${res.status}) ${text}`);
      return (data.threads || []).filter(thread => thread.parent_id === forumId && !thread.archived);
    }

    async function findBraceletCopiesByName(suspect) {
      const wanted = normalizeBraceletName(suspect);
      const targets = [
        { label: "SASP SUD", guildId: SUD_GUILD_ID, forumId: BRACELET_FORUM_CHANNEL },
        { label: "SASP NORD", guildId: NORD_GUILD_ID, forumId: NORD_BRACELET_FORUM_CHANNEL },
        { label: "DOJ", guildId: DOJ_GUILD_ID, forumId: DOJ_BRACELET_FORUM_CHANNEL }
      ];
      const found = [];
      for (const target of targets) {
        try {
          const threads = await getActiveForumThreads(target.guildId, target.forumId);
          for (const thread of threads) {
            if (normalizeBraceletName(thread.name) === wanted) found.push({ ...target, threadId: thread.id, name: thread.name });
          }
        } catch {}
      }
      return found;
    }

    async function getActiveBracelets(env, guildId = env.DISCORD_GUILD_ID || "1500975724750704661", forumId = BRACELET_FORUM_CHANNEL) {
      const activeRes = await discordFetch(`${DISCORD_API}/guilds/${guildId}/threads/active`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      if (!activeRes.ok) throw new Error(`threads active failed: ${activeRes.status} ${await activeRes.text()}`);
      const activeData = await activeRes.json();
      const braceletThreads = (activeData.threads || []).filter(t => t.parent_id === forumId && !t.archived);
      const bracelets = [];
      for (const thread of braceletThreads) {
        const messagesRes = await discordFetch(`${DISCORD_API}/channels/${thread.id}/messages?limit=50`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (!messagesRes.ok) continue;
        const messages = await messagesRes.json();
        const source = Array.isArray(messages)
          ? messages.find(m => String(m.content || "").toUpperCase().includes("BRACELET ELECTRONIQUE DE"))
          : null;
        bracelets.push(parseBraceletMessage(source ? source.content : "", thread));
      }
      return bracelets.sort((a, b) => a.suspect.localeCompare(b.suspect, "fr"));
    }

    async function sendBraceletRecap(env, channelId = STICKY_PROC_CHANNEL, guildId = env.DISCORD_GUILD_ID || "1500975724750704661", forumId = BRACELET_FORUM_CHANNEL, source = "all") {
      const allBracelets = await getActiveBracelets(env, guildId, forumId);
      const bracelets = source === "proc" ? allBracelets.filter(b => b.proc_thread_id) : allBracelets;
      const lines = bracelets.length
        ? bracelets.map((b, i) =>
            `**${i + 1}. ${b.suspect}**\n` +
            `Date de mise : ${b.date}\n` +
            `Telephone : \`${b.tel}\`\n` +
            `Raison : ${b.raison}\n` +
            (b.proc_thread_id ? `Dossier proc : <#${b.proc_thread_id}>\n` : "") +
            `Dossier : <#${b.thread_id}>`
          )
        : [source === "proc" ? "Aucun bracelet actif lie a un /proc trouve." : "Aucun bracelet actif trouve."];
      const description = lines.join("\n\n").slice(0, 4000);
      const oldRes = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages?limit=20`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const oldMsgs = await oldRes.json();
      const oldRecap = Array.isArray(oldMsgs) && oldMsgs.find(m => m.author?.bot && m.embeds?.[0]?.title === "Bracelets actifs");
      if (oldRecap) {
        await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${oldRecap.id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
      }
      const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            title: source === "proc" ? "Bracelets actifs lies a un /proc" : "Bracelets actifs",
            color: 0xc9a84c,
            description,
            footer: { text: `SASP - ${bracelets.length} bracelet(s) actif(s)` },
            timestamp: new Date().toISOString()
          }]
        })
      });
      if (!res.ok) throw new Error(`send recap failed: ${res.status} ${await res.text()}`);
      return { ok: true, count: bracelets.length, total_count: allBracelets.length, channel_id: channelId, guild_id: guildId, forum_id: forumId, source };
    }

    async function copyActiveForumThreads(sourceGuildId, sourceForumId, targetGuildId, targetForumId, start = 0, limit = 5, allowDuplicates = false) {
      await addMissingForumTags(sourceForumId, targetForumId);
      await ensureForumTags(targetForumId, ORIGIN_FORUM_TAGS);

      const [sourceForum, targetForum] = await Promise.all([
        getForumChannel(sourceForumId),
        getForumChannel(targetForumId)
      ]);
      const targetTagsByName = new Map((targetForum.available_tags || []).map(tag => [String(tag.name || "").toLowerCase(), tag.id]));
      const sourceTagsById = new Map((sourceForum.available_tags || []).map(tag => [tag.id, String(tag.name || "")]));

      const sourceLabel = sourceGuildId === NORD_GUILD_ID ? "SASP NORD" : "SASP SUD";
      const allSourceThreads = await getActiveForumThreads(sourceGuildId, sourceForumId);
      const sourceThreads = allSourceThreads.slice(start, start + limit);
      const targetThreads = await getActiveForumThreads(targetGuildId, targetForumId);
      const existingNames = new Set(targetThreads.map(thread => normalizeBraceletName(thread.name)));
      const results = [];

      for (const thread of sourceThreads) {
        const messages = (await getThreadMessages(thread.id)).filter(isUsefulThreadMessage);
        const sourceMessage = messages.find(m => String(m.content || "").toUpperCase().includes("BRACELET ELECTRONIQUE DE")) || messages[0];
        const fallbackSuspect = thread.name.replace(/\|.*$/g, "").replace(/bracelet de/ig, "").replace(/bracelet/ig, "").trim() || thread.name;
        const parsed = sourceMessage
          ? parseBraceletMessage(sourceMessage.content || "", thread)
          : { suspect: fallbackSuspect };
        const targetTitle = braceletTitle(sourceLabel, parsed.suspect);

        if (!allowDuplicates && (existingNames.has(normalizeBraceletName(parsed.suspect)) || existingNames.has(normalizeBraceletName(targetTitle)))) {
          results.push({ name: thread.name, skipped: true, reason: "already_exists" });
          continue;
        }

        const fallbackContent =
          `BRACELET ELECTRONIQUE DE ${String(parsed.suspect || fallbackSuspect).toUpperCase()}\n\n` +
          `Origine : ${sourceLabel}\n` +
          `Informations reprises depuis le forum bracelet ${sourceLabel}. Message source complet non lisible par le bot au moment de la copie.\n\n` +
          `Pensez a bien noter quand les individus viennent pointer`;
        const attachmentLinks = (sourceMessage?.attachments || []).map(a => a.url).filter(Boolean);
        const copiedContent = [normalizeBraceletContent(sourceMessage?.content || fallbackContent, sourceLabel), ...attachmentLinks].filter(Boolean).join("\n");
        const copiedMessage = {
          content: copiedContent || `Copie du dossier : ${targetTitle}`
        };
        if (sourceMessage?.embeds?.length) copiedMessage.embeds = sourceMessage.embeds;
        copiedMessage.components = sourceMessage?.components?.length
          ? sourceMessage.components
          : [{ type: 1, components: [{ type: 2, style: 3, label: "ðŸ“ Pointage", custom_id: "bracelet_pointage" }] }];

        const appliedTagIds = (thread.applied_tags || [])
          .map(id => sourceTagsById.get(id))
          .filter(Boolean)
          .map(name => targetTagsByName.get(String(name).toLowerCase()))
          .filter(Boolean);

        try {
          const created = await createForumThread(targetForumId, targetTitle, copiedMessage, appliedTagIds);
          existingNames.add(normalizeBraceletName(targetTitle));
          let extraSent = 0;
          for (const message of messages) {
            if (sourceMessage && message.id === sourceMessage.id) continue;
            const extraAttachmentLinks = (message.attachments || []).map(a => a.url).filter(Boolean);
            const extraContent = [normalizeBraceletContent(message.content || "", sourceLabel), ...extraAttachmentLinks].filter(Boolean).join("\n");
            const extraPayload = { content: extraContent || `Copie du dossier : ${targetTitle}` };
            if (message.embeds?.length) extraPayload.embeds = message.embeds;
            if (message.components?.length) extraPayload.components = message.components;
            const extraRes = await discordFetch(`${DISCORD_API}/channels/${created.id}/messages`, {
              method: "POST",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify(extraPayload)
            });
            if (extraRes.ok) extraSent++;
          }
          results.push({ name: thread.name, title: targetTitle, ok: true, id: created.id, extra_messages: extraSent });
        } catch (e) {
          results.push({ name: thread.name, ok: false, error: e.message });
        }
      }

      return {
        ok: results.every(result => result.ok || result.skipped),
        source_guild_id: sourceGuildId,
        source_forum_id: sourceForumId,
        target_guild_id: targetGuildId,
        target_forum_id: targetForumId,
        total_source: allSourceThreads.length,
        start,
        limit,
        copied: results.filter(result => result.ok).length,
        skipped: results.filter(result => result.skipped).length,
        failed: results.filter(result => !result.ok && !result.skipped).length,
        results
      };
    }

    async function syncForumThreadMessages(sourceGuildId, sourceForumId, targetGuildId, targetForumId, start = 0, limit = 5) {
      const getActiveThreads = async (guildId, forumId) => {
        const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/threads/active`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok) throw new Error(`${guildId} active threads (${res.status}) ${text}`);
        return (data.threads || []).filter(thread => thread.parent_id === forumId && !thread.archived);
      };

      const getThreadMessages = async (threadId) => {
        const messagesRes = await discordFetch(`${DISCORD_API}/channels/${threadId}/messages?limit=50`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (!messagesRes.ok) {
          await discordFetch(`${DISCORD_API}/channels/${threadId}/thread-members/@me`, {
            method: "PUT",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const retryRes = await discordFetch(`${DISCORD_API}/channels/${threadId}/messages?limit=50`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (!retryRes.ok) return [];
          const retryMessages = await retryRes.json();
          return Array.isArray(retryMessages) ? retryMessages.slice().reverse() : [];
        }
        const messages = await messagesRes.json();
        return Array.isArray(messages) ? messages.slice().reverse() : [];
      };

      const normalizeCopiedContent = (content, sourceLabel) => {
        let text = String(content || "");
        if (text.toUpperCase().includes("BRACELET ELECTRONIQUE DE") && !/^Origine\s*:/im.test(text)) {
          text = text.replace(/(BRACELET ELECTRONIQUE DE[^\n]*\n\n?)/i, `$1Origine : ${sourceLabel}\n`);
        }
        return text;
      };

      const isUsefulThreadMessage = (message) => {
        const text = String(message.content || "");
        return (
          text.trim() ||
          (message.attachments || []).length ||
          (message.embeds || []).length ||
          (message.components || []).length
        ) && !message.system;
      };

      const messageKey = (message, sourceLabel = "") => {
        const attachmentLinks = (message.attachments || []).map(a => a.url).filter(Boolean);
        return [
          normalizeCopiedContent(message.content || "", sourceLabel),
          ...attachmentLinks,
          JSON.stringify(message.embeds || []),
          JSON.stringify(message.components || [])
        ].join("\n").trim();
      };

      const allSourceThreads = await getActiveThreads(sourceGuildId, sourceForumId);
      const sourceThreads = allSourceThreads.slice(start, start + limit);
      const targetThreads = await getActiveThreads(targetGuildId, targetForumId);
      const targetByName = new Map(targetThreads.map(thread => [normalizeBraceletName(thread.name), thread]));
      const results = [];

      for (const sourceThread of sourceThreads) {
        const targetThread = targetByName.get(normalizeBraceletName(sourceThread.name));
        if (!targetThread) {
          results.push({ name: sourceThread.name, ok: false, error: "target_missing" });
          continue;
        }

        const sourceMessages = (await getThreadMessages(sourceThread.id)).filter(isUsefulThreadMessage);
        const targetMessages = (await getThreadMessages(targetThread.id)).filter(isUsefulThreadMessage);
        if (!sourceMessages.length) {
          results.push({ name: sourceThread.name, ok: false, error: "source_messages_missing", target_id: targetThread.id });
          continue;
        }

        const existingKeys = new Set(targetMessages.map(message => messageKey(message, "SASP SUD")));
        let sentCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const sourceMessage of sourceMessages) {
          const key = messageKey(sourceMessage, "SASP SUD");
          if (existingKeys.has(key)) {
            skippedCount++;
            continue;
          }

          const attachmentLinks = (sourceMessage.attachments || []).map(a => a.url).filter(Boolean);
          const copiedContent = [normalizeCopiedContent(sourceMessage.content || "", "SASP SUD"), ...attachmentLinks].filter(Boolean).join("\n");
          const payload = { content: copiedContent || `Copie du dossier : ${sourceThread.name}` };
          if (sourceMessage.embeds?.length) payload.embeds = sourceMessage.embeds;
          if (sourceMessage.components?.length) payload.components = sourceMessage.components;

          const res = await discordFetch(`${DISCORD_API}/channels/${targetThread.id}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            sentCount++;
            existingKeys.add(key);
          } else {
            failedCount++;
          }
        }

        results.push({
          name: sourceThread.name,
          ok: failedCount === 0,
          target_id: targetThread.id,
          sent: sentCount,
          skipped: skippedCount,
          failed: failedCount
        });
      }

      return {
        ok: results.every(result => result.ok),
        total_source: allSourceThreads.length,
        start,
        limit,
        sent: results.reduce((sum, result) => sum + (result.sent || 0), 0),
        skipped: results.reduce((sum, result) => sum + (result.skipped || 0), 0),
        failed: results.reduce((sum, result) => sum + (result.failed || (result.ok === false ? 1 : 0)), 0),
        results
      };
    }

    async function cleanupEmptyBraceletThreads(guildId, forumId, dryRun = true) {
      const activeRes = await discordFetch(`${DISCORD_API}/guilds/${guildId}/threads/active`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const activeText = await activeRes.text();
      let activeData = null;
      try { activeData = activeText ? JSON.parse(activeText) : null; } catch {}
      if (!activeRes.ok) throw new Error(`${guildId} active threads (${activeRes.status}) ${activeText}`);

      const threads = (activeData.threads || []).filter(thread => thread.parent_id === forumId && !thread.archived);
      const results = [];
      for (const thread of threads) {
        const messagesRes = await discordFetch(`${DISCORD_API}/channels/${thread.id}/messages?limit=50`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        if (!messagesRes.ok) {
          results.push({ id: thread.id, name: thread.name, ok: false, error: `messages ${messagesRes.status}` });
          continue;
        }
        const messages = await messagesRes.json();
        const hasBraceletMessage = Array.isArray(messages) && messages.some(m =>
          String(m.content || "").toUpperCase().includes("BRACELET ELECTRONIQUE DE")
        );
        if (hasBraceletMessage) {
          results.push({ id: thread.id, name: thread.name, kept: true });
          continue;
        }
        if (!dryRun) {
          try {
            await closeDiscordThread(thread.id);
          } catch (e) {
            results.push({ id: thread.id, name: thread.name, ok: false, error: e.message });
            continue;
          }
        }
        results.push({ id: thread.id, name: thread.name, removed: !dryRun, would_remove: dryRun });
      }
      return {
        ok: results.every(result => result.kept || result.removed || result.would_remove),
        dry_run: dryRun,
        guild_id: guildId,
        forum_id: forumId,
        total: threads.length,
        kept: results.filter(result => result.kept).length,
        removable: results.filter(result => result.removed || result.would_remove).length,
        failed: results.filter(result => result.ok === false).length,
        results
      };
    }

    async function cleanupForumThreadsNotInSource(sourceGuildId, sourceForumId, targetGuildId, targetForumId, dryRun = true) {
      const getActiveThreads = async (guildId, forumId) => {
        const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/threads/active`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok) throw new Error(`${guildId} active threads (${res.status}) ${text}`);
        return (data.threads || []).filter(thread => thread.parent_id === forumId && !thread.archived);
      };

      const sourceThreads = await getActiveThreads(sourceGuildId, sourceForumId);
      const targetThreads = await getActiveThreads(targetGuildId, targetForumId);
      const sourceNames = new Set(sourceThreads.map(thread => thread.name));
      const results = [];

      for (const thread of targetThreads) {
        if (sourceNames.has(thread.name)) {
          results.push({ id: thread.id, name: thread.name, kept: true });
          continue;
        }
        if (!dryRun) {
          try {
            await closeDiscordThread(thread.id);
          } catch (e) {
            results.push({ id: thread.id, name: thread.name, ok: false, error: e.message });
            continue;
          }
        }
        results.push({ id: thread.id, name: thread.name, removed: !dryRun, would_remove: dryRun });
      }

      return {
        ok: results.every(result => result.kept || result.removed || result.would_remove),
        dry_run: dryRun,
        source_total: sourceThreads.length,
        target_total: targetThreads.length,
        kept: results.filter(result => result.kept).length,
        removable: results.filter(result => result.removed || result.would_remove).length,
        failed: results.filter(result => result.ok === false).length,
        results
      };
    }
    const STICKY_SUBVENTION_EMBED = {
      embeds: [{
        title: "ðŸ’¸ RÃ¨gles subvention",
        color: 0xc9a84c,
        description: "Pour faire une demande de subvention, utilisez la commande `/subvention` ou le bouton ci-dessous.\n\n**RÃ¨gles actuelles :**\nâ€¢ La subvention est fixÃ©e Ã  **10 000 $ par voiture** pour le moment.\nâ€¢ Il est interdit de faire des **performances** avec cette subvention.\nâ€¢ Il est interdit d'acheter une **nouvelle voiture** avec cette subvention.",
        footer: { text: "SASP â€¢ Subvention" }
      }],
      components: [{
        type: 1,
        components: [{
          type: 2,
          custom_id: "subvention_open_modal",
          label: "Faire une demande",
          style: 3,
          emoji: { name: "ðŸ’¸" }
        }]
      }]
    };
    function subventionModalResponse() {
      return {
        type: 9,
        data: {
          custom_id: "subvention_modal",
          title: "Demande de subvention",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "sub_raison", label: "Raison de la subvention", style: 2, required: true, placeholder: "Expliquez la raison de la demandeâ€¦", min_length: 5, max_length: 1000 }] },
            { type: 1, components: [{ type: 4, custom_id: "sub_somme", label: "Somme demandee", style: 1, required: true, placeholder: "Ex : 10000", min_length: 2, max_length: 20 }] }
          ]
        }
      };
    }
    function candidatureModalResponse(customId = "candidature_modal") {
      return {
        type: 9,
        data: {
          custom_id: customId,
          title: "Candidature Police Academy",
          components: [
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: "cand_telephone",
                label: "Numéro de téléphone",
                style: 1,
                required: true,
                placeholder: "Ex : 555-1234",
                min_length: 7,
                max_length: 30
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: "cand_disponibilite",
                label: "Disponibilité",
                style: 2,
                required: true,
                placeholder: "Ex : soirs, week-end, vacances, horaires...",
                min_length: 3,
                max_length: 1000
              }]
            },
            {
              type: 1,
              components: [{
                type: 4,
                custom_id: "cand_experience",
                label: "Expérience passée",
                style: 2,
                required: true,
                placeholder: "Experience RP / police / secourisme / conduite / autre...",
                min_length: 3,
                max_length: 1500
              }]
            }
          ]
        }
      };
    }
    function cnuModalResponse(customId = "cnu_modal") {
      return {
        type: 9,
        data: {
          custom_id: customId,
          title: "Formulaire CNU",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "cnu_telephone", label: "Numéro de téléphone", style: 1, required: true, placeholder: "Ex : 555-1234", min_length: 7, max_length: 30 }] },
            { type: 1, components: [{ type: 4, custom_id: "cnu_formations", label: "Formations CNU déjà suivies", style: 2, required: true, placeholder: "Si oui, précisez lesquelles. Sinon indiquez Non.", min_length: 2, max_length: 1000 }] },
            { type: 1, components: [{ type: 4, custom_id: "cnu_poste", label: "Poste souhaité", style: 1, required: true, placeholder: "Lead Terrain, Négociateur ou les deux", min_length: 2, max_length: 80 }] },
            { type: 1, components: [{ type: 4, custom_id: "cnu_experience", label: "Expérience en négociation de crise", style: 2, required: true, placeholder: "Décrivez brièvement vos expériences ou situations rencontrées.", min_length: 3, max_length: 1500 }] },
            { type: 1, components: [{ type: 4, custom_id: "cnu_motivation", label: "Motivation pour rejoindre la CNU", style: 2, required: true, placeholder: "Expliquez vos motivations et ce que vous pouvez apporter à l'unité.", min_length: 3, max_length: 1500 }] }
          ]
        }
      };
    }
    function swatModalResponse(customId = "swat_modal") {
      return {
        type: 9,
        data: {
          custom_id: customId,
          title: "Formulaire SWAT",
          components: [
            { type: 1, components: [{ type: 4, custom_id: "swat_affectation", label: "Ancienne / actuelle affectation", style: 1, required: true, placeholder: "Indiquez votre affectation actuelle ou votre dernière affectation.", min_length: 2, max_length: 100 }] },
            { type: 1, components: [{ type: 4, custom_id: "swat_experience_lo", label: "Expérience forces de l'ordre", style: 1, required: true, placeholder: "0-2 ans, 3-5 ans, 6-10 ans ou 10 ans et plus", min_length: 2, max_length: 80 }] },
            { type: 1, components: [{ type: 4, custom_id: "swat_risque", label: "Interventions à haut risque", style: 2, required: true, placeholder: "Si oui, précisez lesquelles. Sinon indiquez Non.", min_length: 2, max_length: 1000 }] },
            { type: 1, components: [{ type: 4, custom_id: "swat_unites", label: "Unités spécialisées", style: 2, required: true, placeholder: "Si oui, précisez laquelle et votre rôle. Sinon indiquez Non.", min_length: 2, max_length: 1000 }] },
            { type: 1, components: [{ type: 4, custom_id: "swat_motivation", label: "Motivation et objectifs", style: 2, required: true, placeholder: "Pourquoi souhaitez-vous rejoindre cette unité et quels sont vos objectifs ?", min_length: 3, max_length: 1500 }] }
          ]
        }
      };
    }
    function isSubventionStickyMessage(message) {
      const embed = message?.embeds?.[0];
      const title = String(embed?.title || "").toLowerCase();
      const description = String(embed?.description || "").toLowerCase();
      return title.includes("subvention") && description.includes("/subvention");
    }
    async function refreshSubventionSticky() {
      const msgsRes = await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages?limit=100`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const msgs = await msgsRes.json();
      const stickies = Array.isArray(msgs) ? msgs.filter(isSubventionStickyMessage) : [];
      const keep = stickies[0] || null;
      for (const sticky of stickies.slice(1)) {
        await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages/${sticky.id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
      }
      const message = keep ? await (async () => {
        const res = await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages/${keep.id}`, {
          method: "PATCH",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(STICKY_SUBVENTION_EMBED)
        });
        if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => "") };
        return await res.json();
      })() : await (async () => {
        const res = await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify(STICKY_SUBVENTION_EMBED)
        });
        if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => "") };
        return await res.json();
      })();
      if (!message?.id) return { ok: false, error: "message_subvention_introuvable", message };
      const pinRes = await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/pins/${message.id}`, {
        method: "PUT",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      return { ok: pinRes.ok || pinRes.status === 204, status: pinRes.status, id: message.id };
    }
    if (url.pathname === "/admin/send-sticky-proc" && request.method === "GET") {
      const targets = [
        { name: "SASP SUD", channel_id: STICKY_PROC_CHANNEL },
        { name: "SASP NORD", channel_id: NORD_COMMAND_CHANNEL }
      ];
      const results = [];
      for (const target of targets) {
        const res = await refreshProcSticky(target.channel_id);
        let data = null;
        try { data = await res.json(); } catch {}
        results.push({ ...target, ok: res.ok, status: res.status, id: data?.id || null });
      }
      return json({ ok: results.every(r => r.ok), results });
    }
    if (url.pathname === "/admin/send-bracelet-recap" && request.method === "GET") {
      try {
        return json(await sendBraceletRecap(
          env,
          url.searchParams.get("channel_id") || STICKY_PROC_CHANNEL,
          url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661",
          url.searchParams.get("forum_id") || BRACELET_FORUM_CHANNEL,
          url.searchParams.get("source") || "all"
        ));
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/copy-forum-threads" && request.method === "GET") {
      try {
        return json(await copyActiveForumThreads(
          url.searchParams.get("source_guild_id") || SUD_GUILD_ID,
          url.searchParams.get("source_forum_id") || BRACELET_FORUM_CHANNEL,
          url.searchParams.get("target_guild_id") || NORD_GUILD_ID,
          url.searchParams.get("target_forum_id") || NORD_BRACELET_FORUM_CHANNEL,
          Number(url.searchParams.get("start") || "0"),
          Number(url.searchParams.get("limit") || "5"),
          url.searchParams.get("allow_duplicates") === "true"
        ));
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/sync-forum-thread-messages" && request.method === "GET") {
      try {
        return json(await syncForumThreadMessages(
          url.searchParams.get("source_guild_id") || SUD_GUILD_ID,
          url.searchParams.get("source_forum_id") || BRACELET_FORUM_CHANNEL,
          url.searchParams.get("target_guild_id") || NORD_GUILD_ID,
          url.searchParams.get("target_forum_id") || NORD_BRACELET_FORUM_CHANNEL,
          Number(url.searchParams.get("start") || "0"),
          Number(url.searchParams.get("limit") || "5")
        ));
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/cleanup-empty-bracelet-threads" && request.method === "GET") {
      try {
        return json(await cleanupEmptyBraceletThreads(
          url.searchParams.get("guild_id") || NORD_GUILD_ID,
          url.searchParams.get("forum_id") || NORD_BRACELET_FORUM_CHANNEL,
          url.searchParams.get("dry_run") !== "false"
        ));
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/cleanup-forum-threads-not-in-source" && request.method === "GET") {
      try {
        return json(await cleanupForumThreadsNotInSource(
          url.searchParams.get("source_guild_id") || SUD_GUILD_ID,
          url.searchParams.get("source_forum_id") || BRACELET_FORUM_CHANNEL,
          url.searchParams.get("target_guild_id") || NORD_GUILD_ID,
          url.searchParams.get("target_forum_id") || NORD_BRACELET_FORUM_CHANNEL,
          url.searchParams.get("dry_run") !== "false"
        ));
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/send-sticky-subvention" && request.method === "GET") {
      return json(await refreshSubventionSticky());
    }
    if (url.pathname === "/admin/bot-invite" && request.method === "GET") {
      const appId = env.DISCORD_APPLICATION_ID;
      if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
      const permissions = "274878221376";
      return json({
        ok: true,
        invite_url: `https://discord.com/oauth2/authorize?client_id=${appId}&permissions=${permissions}&integration_type=0&scope=bot+applications.commands`
      });
    }
    if (url.pathname === "/admin/sync-judicial-tags" && request.method === "GET") {
      const results = [];
      const errors = [];
      const jobs = [
        ["proc-nord", "1521565049729187961", NORD_PROC_FORUM_CHANNEL],
        ["proc-doj", "1521565049729187961", DOJ_PROC_FORUM_CHANNEL],
        ["bracelet-nord", BRACELET_FORUM_CHANNEL, NORD_BRACELET_FORUM_CHANNEL],
        ["bracelet-doj", BRACELET_FORUM_CHANNEL, DOJ_BRACELET_FORUM_CHANNEL]
      ];
      for (const [name, source, target] of jobs) {
        try {
          const copied = await addMissingForumTags(source, target);
          const originTagIds = await ensureForumTags(target, ORIGIN_FORUM_TAGS);
          results.push({ name, ...copied, origin_tags: originTagIds.length });
        } catch (e) {
          errors.push({ name, error: e.message });
        }
      }
      for (const [name, channelId] of [
        ["proc-sud", "1521565049729187961"],
        ["bracelet-sud", BRACELET_FORUM_CHANNEL]
      ]) {
        try {
          const originTagIds = await ensureForumTags(channelId, ORIGIN_FORUM_TAGS);
          results.push({ name, target: channelId, added: 0, origin_tags: originTagIds.length });
        } catch (e) {
          errors.push({ name, error: e.message });
        }
      }
      return json({ ok: errors.length === 0, results, errors });
    }

    // Installer la commande /plainte
    if (url.pathname === "/admin/install-plainte-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "plainte", description: "DÃ©poser une plainte officielle SASP" })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    // Installer la commande /plaintesasp
    if (url.pathname === "/admin/install-plaintesasp-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "plaintesasp", description: "Transmettre une plainte SASP" })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/kick-non-sasp" && request.method === "GET") {
      const SASP_GUILD   = "1500975724750704661";
      const TARGET_GUILD = "1382167184607940658";
      const ALLOWED_ROLES = ["1501250580058870104", "1512410095173238814"];
      try {
        const targetMembers = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members?limit=1000`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        }).then(r => r.json());
        let kicked = 0, kept = 0, errors = [];
        for (const m of targetMembers) {
          if (m.user?.bot) continue;
          const uid = m.user?.id;
          if (!uid) continue;
          const saspRes = await discordFetch(`${DISCORD_API}/guilds/${SASP_GUILD}/members/${uid}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          }).catch(() => null);
          if (!saspRes || (saspRes.status !== 200 && saspRes.status !== 404)) { kept++; continue; } // erreur API → on ne kicike pas
          const saspMember = saspRes.status === 200 ? await saspRes.json() : null;
          const hasRole = saspMember && ALLOWED_ROLES.some(r => (saspMember.roles || []).includes(r));
          if (!hasRole) {
            const res = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members/${uid}`, {
              method: "DELETE",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
            if (res.status === 204) kicked++;
            else errors.push(`${uid}: ${res.status}`);
          } else {
            kept++;
          }
        }
        return json({ ok: true, kicked, kept, errors });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/sync-nicks" && request.method === "GET") {
      const SOURCE_GUILD = "1500975724750704661";
      const TARGET_GUILD = "1382167184607940658";
      const after = url.searchParams.get("after") || "0";
      const PAGE = 20;
      try {
        // Parcourt les membres du serveur secondaire
        const targetMembers = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members?limit=${PAGE}&after=${after}`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        }).then(r => r.json());
        let synced = 0, skipped = 0, errors = [];
        for (const m of targetMembers) {
          const uid = m.user?.id;
          if (!uid || m.user?.bot) continue;
          // Récupère le pseudo depuis le SASP principal
          const sourceMember = await discordFetch(`${DISCORD_API}/guilds/${SOURCE_GUILD}/members/${uid}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
          if (!sourceMember) { skipped++; continue; }
          let res;
          for (let attempt = 0; attempt < 3; attempt++) {
            res = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members/${uid}`, {
              method: "PATCH",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify({ nick: sourceMember.nick || null })
            });
            if (res.status === 429) {
              const body = await res.json().catch(() => ({}));
              const wait = (body.retry_after || 1) * 1000;
              await new Promise(r => setTimeout(r, wait));
            } else break;
          }
          if (res.status === 204 || res.status === 200) synced++;
          else if (res.status === 403) skipped++;
          else errors.push(`${uid}: ${res.status}`);
          await new Promise(r => setTimeout(r, 300));
        }
        const next_after = targetMembers.length === PAGE ? targetMembers[targetMembers.length - 1].user.id : null;
        return json({ ok: true, synced, skipped, errors, next_after, done: !next_after });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-bracelet-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "bracelet", description: "CrÃ©er un bracelet Ã©lectronique sans proc" })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-subvention-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const reset = url.searchParams.get("reset") === "1";
        const resetDeleted = [];
        if (reset) {
          const listRes = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const commands = await listRes.json();
          if (!listRes.ok) return json({ ok: false, step: "list", data: commands }, listRes.status);
          for (const command of commands.filter(c => c.name === "subvention")) {
            const delRes = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands/${command.id}`, {
              method: "DELETE",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
            resetDeleted.push({ id: command.id, ok: delRes.status === 204, status: delRes.status });
          }
        }
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "subvention", description: "DÃ©poser une demande de subvention agent" })
        });
        const data = await res.json();
        return json({ ok: res.ok, reset, resetDeleted, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-heures-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const reset = url.searchParams.get("reset") === "1";
        const resetDeleted = [];
        if (reset) {
          const listRes = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const commands = await listRes.json();
          if (!listRes.ok) return json({ ok: false, step: "list", data: commands }, listRes.status);
          for (const command of commands.filter(c => c.name === "heures")) {
            const delRes = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands/${command.id}`, {
              method: "DELETE",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
            resetDeleted.push({ id: command.id, ok: delRes.status === 204, status: delRes.status });
          }
        }
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "heures", description: "Voir mes heures de service et ma paie de la semaine" })
        });
        const data = await res.json();
        return json({ ok: res.ok, reset, resetDeleted, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/debug-commands" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const data = await res.json();
        if (!res.ok) return json({ ok: false, data }, res.status);
        const names = (url.searchParams.get("names") || "proc,subvention").split(",").map(s => s.trim()).filter(Boolean);
        return json({
          ok: true,
          guild_id: guildId,
          total: data.length,
          commands: data
            .filter(command => names.includes(command.name))
            .map(command => ({
              id: command.id,
              application_id: command.application_id,
              name: command.name,
              description: command.description,
              type: command.type,
              version: command.version,
              default_member_permissions: command.default_member_permissions ?? null,
              dm_permission: command.dm_permission ?? null,
              contexts: command.contexts ?? null,
              integration_types: command.integration_types ?? null,
              options: command.options || []
            }))
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/debug-command-permissions" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        const name = url.searchParams.get("name") || "subvention";
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const listRes = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const commands = await listRes.json();
        if (!listRes.ok) return json({ ok: false, step: "list", data: commands }, listRes.status);
        const command = commands.find(c => c.name === name);
        if (!command) return json({ ok: false, error: "commande_introuvable", name, commands: commands.map(c => c.name) }, 404);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands/${command.id}/permissions`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const data = await res.json();
        return json({ ok: res.ok, guild_id: guildId, command: { id: command.id, name: command.name }, status: res.status, data }, res.ok ? 200 : res.status);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/debug-channel-command-perms" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const roleIds = (url.searchParams.get("role_ids") || guildId).split(",").map(s => s.trim()).filter(Boolean);
        const USE_APPLICATION_COMMANDS = 2147483648n;
        const patchableTypes = new Set([0, 4, 5, 15, 16]);
        const channelsRes = await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const channels = await channelsRes.json();
        if (!channelsRes.ok) return json({ ok: false, step: "channels", data: channels }, channelsRes.status);
        const summary = {};
        for (const roleId of roleIds) summary[roleId] = { allow: 0, deny: 0, missing: 0, denied_channels: [] };
        for (const channel of channels.filter(ch => patchableTypes.has(ch.type))) {
          for (const roleId of roleIds) {
            const overwrite = (channel.permission_overwrites || []).find(o => String(o.id) === String(roleId) && Number(o.type) === 0);
            if (!overwrite) {
              summary[roleId].missing++;
              continue;
            }
            const allow = BigInt(overwrite.allow || "0");
            const deny = BigInt(overwrite.deny || "0");
            if ((allow & USE_APPLICATION_COMMANDS) === USE_APPLICATION_COMMANDS) summary[roleId].allow++;
            if ((deny & USE_APPLICATION_COMMANDS) === USE_APPLICATION_COMMANDS) {
              summary[roleId].deny++;
              summary[roleId].denied_channels.push({ id: channel.id, name: channel.name, type: channel.type });
            }
          }
        }
        return json({ ok: true, guild_id: guildId, roles: summary });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/allow-role-slash-commands" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const roleIds = (url.searchParams.get("role_ids") || "").split(",").map(s => s.trim()).filter(Boolean);
        if (!roleIds.length) return json({ ok: false, error: "role_ids manquant" }, 400);
        const USE_APPLICATION_COMMANDS = 2147483648n;
        const rolesRes = await discordFetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const roles = await rolesRes.json();
        if (!rolesRes.ok) return json({ ok: false, step: "roles", data: roles }, rolesRes.status);
        const byId = new Map(roles.map(role => [String(role.id), role]));
        const results = [];
        for (const roleId of roleIds) {
          const role = byId.get(String(roleId));
          if (!role) {
            results.push({ role_id: roleId, ok: false, error: "role_introuvable" });
            continue;
          }
          const current = BigInt(role.permissions || "0");
          const next = current | USE_APPLICATION_COMMANDS;
          if (current === next) {
            results.push({ role_id: roleId, name: role.name, ok: true, unchanged: true, permissions: next.toString() });
            continue;
          }
          const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/roles/${roleId}`, {
            method: "PATCH",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ permissions: next.toString() })
          });
          results.push({ role_id: roleId, name: role.name, ok: res.ok, status: res.status, permissions: next.toString(), body: res.ok ? null : await res.text() });
        }
        return json({ ok: results.every(r => r.ok), guild_id: guildId, results });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/clear-slash-command-denies" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const dryRun = url.searchParams.get("dry") === "1";
        const start = Math.max(0, Number(url.searchParams.get("start") || 0));
        const limit = Math.max(1, Math.min(30, Number(url.searchParams.get("limit") || 20)));
        const USE_APPLICATION_COMMANDS = 2147483648n;
        const patchableTypes = new Set([0, 4, 5, 15, 16]);
        const channelsRes = await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const channels = await channelsRes.json();
        if (!channelsRes.ok) return json({ ok: false, step: "channels", data: channels }, channelsRes.status);
        const patchable = channels.filter(ch => patchableTypes.has(ch.type));
        const changes = [];
        for (const channel of patchable.slice(start, start + limit)) {
          for (const overwrite of channel.permission_overwrites || []) {
            const deny = BigInt(overwrite.deny || "0");
            if ((deny & USE_APPLICATION_COMMANDS) !== USE_APPLICATION_COMMANDS) continue;
            const allow = BigInt(overwrite.allow || "0");
            const nextDeny = deny & ~USE_APPLICATION_COMMANDS;
            if (dryRun) {
              changes.push({ channel_id: channel.id, channel_name: channel.name, overwrite_id: overwrite.id, type: overwrite.type, dry: true });
              continue;
            }
            const res = await discordFetch(`${DISCORD_API}/channels/${channel.id}/permissions/${overwrite.id}`, {
              method: "PUT",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify({ type: Number(overwrite.type), allow: allow.toString(), deny: nextDeny.toString() })
            });
            changes.push({ channel_id: channel.id, channel_name: channel.name, overwrite_id: overwrite.id, type: overwrite.type, ok: res.ok, status: res.status, body: res.ok ? null : await res.text() });
          }
        }
        return json({
          ok: changes.every(change => change.dry || change.ok),
          guild_id: guildId,
          start,
          limit,
          total: patchable.length,
          next_start: start + limit < patchable.length ? start + limit : null,
          changes
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/allow-slash-commands-everywhere" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const targetRoleId = url.searchParams.get("role_id") || guildId;
        const dryRun = url.searchParams.get("dry") === "1";
        const start = Math.max(0, Number(url.searchParams.get("start") || 0));
        const limit = Math.max(1, Math.min(40, Number(url.searchParams.get("limit") || 25)));
        const USE_APPLICATION_COMMANDS = 2147483648n;
        const patchableTypes = new Set([0, 4, 5, 15, 16]);
        const channelsRes = await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const channels = await channelsRes.json();
        if (!channelsRes.ok) return json({ ok: false, step: "channels", data: channels }, channelsRes.status);
        const results = [];
        const patchable = channels.filter(ch => patchableTypes.has(ch.type));
        for (const channel of patchable.slice(start, start + limit)) {
          const overwrite = (channel.permission_overwrites || []).find(o => String(o.id) === String(targetRoleId) && Number(o.type) === 0);
          const allow = (overwrite ? BigInt(overwrite.allow || "0") : 0n) | USE_APPLICATION_COMMANDS;
          const deny = (overwrite ? BigInt(overwrite.deny || "0") : 0n) & ~USE_APPLICATION_COMMANDS;
          if (dryRun) {
            results.push({ id: channel.id, name: channel.name, type: channel.type, dry: true, allow: allow.toString(), deny: deny.toString() });
            continue;
          }
          const res = await discordFetch(`${DISCORD_API}/channels/${channel.id}/permissions/${targetRoleId}`, {
            method: "PUT",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ type: 0, allow: allow.toString(), deny: deny.toString() })
          });
          results.push({ id: channel.id, name: channel.name, type: channel.type, ok: res.ok, status: res.status, body: res.ok ? null : await res.text() });
        }
        return json({ ok: results.every(r => r.dry || r.ok), guild_id: guildId, role_id: targetRoleId, start, limit, total: patchable.length, next_start: start + limit < patchable.length ? start + limit : null, count: results.length, results });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-message-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "message",
            description: "Faire envoyer un message par le bot dans ce salon",
            options: [
              {
                type: 3,
                name: "texte",
                description: "Message a envoyer dans ce salon",
                required: true,
                max_length: 2000
              }
            ]
          })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-defcon-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "defcon",
            description: "Publier une alerte DEFCON SASP",
            options: [
              {
                type: 3,
                name: "niveau",
                description: "Niveau DEFCON a publier",
                required: true,
                choices: [
                  { name: "DEFCON 1", value: "1" },
                  { name: "DEFCON 2", value: "2" },
                  { name: "DEFCON 3", value: "3" },
                  { name: "DEFCON 4", value: "4" },
                  { name: "DEFCON 5", value: "5" }
                ]
              }
            ]
          })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-candidature-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const reset = url.searchParams.get("reset") === "1";
        const resetDeleted = [];
        if (reset) {
          const listRes = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const commands = await listRes.json();
          if (!listRes.ok) return json({ ok: false, step: "list", data: commands }, listRes.status);
          for (const command of commands.filter(c => c.name === "candidature")) {
            const delRes = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands/${command.id}`, {
              method: "DELETE",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
            resetDeleted.push({ id: command.id, ok: delRes.status === 204, status: delRes.status });
          }
        }
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "candidature",
            description: "Remplir une candidature Police Academy"
          })
        });
        const data = await res.json();
        return json({ ok: res.ok, reset, resetDeleted, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-clear-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "clear",
            description: "Nettoyer le salon actuel",
            options: [
              {
                type: 1,
                name: "messages",
                description: "Supprimer un nombre de messages recents",
                options: [{
                  type: 4,
                  name: "nombre",
                  description: "Nombre de messages a supprimer, maximum 100",
                  required: true,
                  min_value: 1,
                  max_value: 100
                }]
              },
              {
                type: 1,
                name: "all",
                description: "Remettre ce salon a zero en le recreant"
              }
            ]
          })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-location-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "location",
            description: "Poster le panneau de location des logements de service"
          })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-ticket-tools-commands" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const commands = [
          {
            name: "add",
            description: "Ajouter un membre au ticket",
            options: [{
              type: 6,
              name: "membre",
              description: "Membre a ajouter au ticket",
              required: true
            }]
          },
          {
            name: "remove",
            description: "Retirer un membre du ticket",
            options: [{
              type: 6,
              name: "membre",
              description: "Membre a retirer du ticket",
              required: true
            }]
          },
          {
            name: "rename",
            description: "Renommer le ticket",
            options: [{
              type: 3,
              name: "nom",
              description: "Nouveau nom du ticket",
              required: true,
              max_length: 90
            }]
          }
        ];
        const results = [];
        for (const command of commands) {
          const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(command)
          });
          const data = await res.json().catch(() => null);
          results.push({ name: command.name, ok: res.ok, status: res.status, data });
        }
        return json({ ok: results.every(result => result.ok), results });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-ticket-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "ticket-panel",
            description: "Poster un panneau de tickets SASP",
            options: [
              {
                type: 7,
                name: "salon",
                description: "Salon ou envoyer le panneau",
                required: false,
                channel_types: [0, 5]
              },
              {
                type: 3,
                name: "categorie",
                description: "Categorie par defaut si une division n'a pas sa categorie",
                required: false
              },
              { type: 3, name: "cat_etat_major", description: "Categorie tickets Etat-Major", required: false },
              { type: 3, name: "cat_academy", description: "Categorie tickets Police Academy", required: false },
              { type: 3, name: "cat_cnu", description: "Categorie tickets CNU", required: false },
              { type: 3, name: "cat_tu", description: "Categorie tickets Traffic Unit", required: false },
              { type: 3, name: "cat_cid", description: "Categorie tickets CID", required: false },
              { type: 3, name: "cat_swat", description: "Categorie tickets SWAT", required: false },
              { type: 3, name: "cat_ftf", description: "Categorie tickets FTF", required: false },
              { type: 3, name: "cat_syndicat", description: "Categorie tickets Syndicat", required: false },
              { type: 3, name: "cat_k9", description: "Categorie tickets K9", required: false },
              {
                type: 3,
                name: "cat_ai",
                description: "Categorie tickets Affaires Internes",
                required: false
              }
            ]
          })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/send-ticket-panel" && request.method === "POST") {
      try {
        const token = request.headers.get("x-log-token");
        if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
        const body = await request.json().catch(() => ({}));
        const channelId = String(body.channel_id || body.channelId || TICKET_DEFAULT_PANEL_CHANNEL_ID).replace(/\D/g, "");
        if (!channelId) return json({ ok: false, error: "channel_id manquant" }, 400);
        const message = await sendTicketPanel(env, channelId, body);
        return json({ ok: true, channel_id: channelId, message_id: message.id });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/tickets/publish-panel" && request.method === "POST") {
      try {
        const token = request.headers.get("x-log-token");
        if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
        const body = await request.json().catch(() => ({}));
        const panelId = String(body.panel_id || body.panelId || "").trim();
        const guildId = String(body.guild_id || body.guildId || env.DISCORD_GUILD_ID || "1500975724750704661").replace(/\D/g, "");
        if (!panelId) return json({ ok: false, error: "panel_id manquant" }, 400);
        const result = await publishTicketPanelFromDb(env, panelId, guildId);
        return json({ ok: true, ...result });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-sync-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || "1382167184607940658";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "sync", description: "Forcer la synchronisation des pseudos depuis le SASP Centrale" })
        });
        const data = await res.json();
        return json({ ok: res.ok, data });
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    if (url.pathname === "/admin/install-proc-command" && request.method === "GET") {
      try {
        const guildId = url.searchParams.get("guild_id") || env.DISCORD_GUILD_ID || "1500975724750704661";
        const appId = env.DISCORD_APPLICATION_ID;
        if (!appId) return json({ ok: false, error: "DISCORD_APPLICATION_ID manquant" }, 400);
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "proc", description: "CrÃ©er une demande procureur SASP" })
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

      let interaction;
      try { interaction = JSON.parse(body); } catch { return json({ error: "Bad JSON" }, 400); }
      try {

      // Ping
      if (interaction.type === 1) return json({ type: 1 });

      // Slash command /location
      if (interaction.type === 2 && interaction.data.name === "location") {
        const member = interaction.member || {};
        if (!hasStaffRole(member)) {
          return json({ type: 4, data: { content: "Tu n'as pas les permissions pour utiliser cette commande.", flags: 64 } });
        }

        const res = await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: "🏠 Location logements de service",
              description: [
                "Sélectionnez le type de logement souhaité.",
                "Une liaison privée sera ouverte automatiquement avec l'administration."
              ].join("\n"),
              color: 0xc9a84c,
              fields: [
                { name: "🏡 Bas de gamme", value: "**2500 $ / semaine**\nLogement simple, attribution rapide.", inline: true },
                { name: "🏘️ Haut de gamme", value: "**3500 $ / semaine**\nLogement premium, selon disponibilité.", inline: true }
              ],
              footer: { text: "SASP - Logements de service" }
            }],
            components: [{
              type: 1,
              components: [
                { type: 2, style: 2, label: "Bas de gamme", emoji: { name: "🏡" }, custom_id: "service_housing_location|bas" },
                { type: 2, style: 1, label: "Haut de gamme", emoji: { name: "🏘️" }, custom_id: "service_housing_location|haut" }
              ]
            }]
          })
        });
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return json({ type: 4, data: { content: `Erreur panneau location (${res.status}) : ${err.slice(0, 500)}`, flags: 64 } });
        }
        return json({ type: 4, data: { content: "Panneau location envoye.", flags: 64 } });
      }

      // Slash command /ticket-panel
      if (interaction.type === 2 && interaction.data.name === "ticket-panel") {
        const member = interaction.member || {};
        if (!hasStaffRole(member)) {
          return json({ type: 4, data: { content: "Tu n'as pas les permissions pour utiliser cette commande.", flags: 64 } });
        }
        const options = interaction.data.options || [];
        const optionValue = (name) => String(options.find(o => o.name === name)?.value || "").replace(/\D/g, "");
        const targetChannelId = String(options.find(o => o.name === "salon")?.value || interaction.channel_id).replace(/\D/g, "");
        const categoryId = optionValue("categorie") || TICKET_DEFAULT_CATEGORY_ID;
        const categoryByKey = {
          "etat-major": optionValue("cat_etat_major"),
          "police-academy": optionValue("cat_academy"),
          cnu: optionValue("cat_cnu"),
          "traffic-unit": optionValue("cat_tu"),
          cid: optionValue("cat_cid"),
          swat: optionValue("cat_swat"),
          ftf: optionValue("cat_ftf"),
          syndicat: optionValue("cat_syndicat"),
          k9: optionValue("cat_k9"),
          "affaires-internes": optionValue("cat_ai")
        };
        const panelOptions = TICKET_OPTIONS.map(option => ({
          ...option,
          categoryId: categoryByKey[option.key] || option.categoryId || categoryId
        }));
        try {
          await sendTicketPanel(env, targetChannelId, { category_id: categoryId, options: panelOptions });
          return json({ type: 4, data: { content: `Panneau tickets envoye dans <#${targetChannelId}>.`, flags: 64 } });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur panneau tickets : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      // Slash commands tickets: /add, /remove, /rename
      if (interaction.type === 2 && ["add", "remove", "rename"].includes(interaction.data.name)) {
        try {
          if (interaction.data.name === "add") {
            const targetId = String(commandOptionValue(interaction, "membre") || "").replace(/\D/g, "");
            if (!targetId) return json({ type: 4, data: { content: "Membre invalide.", flags: 64 } });
            await addTicketMember(env, interaction, targetId);
            return json({ type: 4, data: { content: `<@${targetId}> ajoute au ticket.`, flags: 64, allowed_mentions: { users: [targetId], parse: [] } } });
          }

          if (interaction.data.name === "remove") {
            const targetId = String(commandOptionValue(interaction, "membre") || "").replace(/\D/g, "");
            if (!targetId) return json({ type: 4, data: { content: "Membre invalide.", flags: 64 } });
            await removeTicketMember(env, interaction, targetId);
            return json({ type: 4, data: { content: `<@${targetId}> retire du ticket.`, flags: 64, allowed_mentions: { users: [targetId], parse: [] } } });
          }

          const rawName = String(commandOptionValue(interaction, "nom") || "").trim();
          if (!rawName) return json({ type: 4, data: { content: "Nom invalide.", flags: 64 } });
          const newName = await renameTicketChannel(env, interaction, rawName);
          return json({ type: 4, data: { content: `Ticket renomme : #${newName}`, flags: 64 } });
        } catch (e) {
          const message = e?.isUserError ? e.message : `Erreur ticket : ${String(e.message || e).slice(0, 1500)}`;
          return json({ type: 4, data: { content: message, flags: 64 } });
        }
      }

      // Tickets avances geres depuis le site
      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_open_db|")) {
        const panelId = interaction.data.custom_id.split("|")[1];
        const optionId = String(interaction.data.values?.[0] || "");
        try {
          const result = await createTicketChannelFromDb(env, interaction, panelId, optionId);
          if (result.limited) {
            return json({ type: 4, data: { content: `Tu as deja un ticket ouvert : <#${result.channel_id}>.`, flags: 64 } });
          }
          return json({ type: 4, data: { content: `Ticket ouvert : <#${result.channel_id}>.`, flags: 64 } });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur ticket : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_open_button_db|")) {
        const [, panelId, optionId] = interaction.data.custom_id.split("|");
        try {
          const result = await createTicketChannelFromDb(env, interaction, panelId, optionId);
          if (result.limited) {
            return json({ type: 4, data: { content: `Tu as deja un ticket ouvert : <#${result.channel_id}>.`, flags: 64 } });
          }
          return json({ type: 4, data: { content: `Ticket ouvert : <#${result.channel_id}>.`, flags: 64 } });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur ticket : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_claim_db|")) {
        const ticketId = interaction.data.custom_id.split("|")[1];
        try {
          await claimTicketDb(env, interaction, ticketId);
          const userId = interaction.member?.user?.id || interaction.user?.id;
          return json({ type: 4, data: { content: `Ticket pris en charge par <@${userId}>.` } });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur prise en charge : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_close_db|")) {
        const [, ticketId, requesterId] = interaction.data.custom_id.split("|");
        try {
          await closeTicketDb(env, interaction, ticketId, requesterId);
          return json({ type: 4, data: { content: "Ticket ferme." } });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur fermeture : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      // Select menu tickets
      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_open_select|")) {
        const [, rawCategoryId, panelKey = ""] = interaction.data.custom_id.split("|");
        const categoryId = String(rawCategoryId || TICKET_DEFAULT_CATEGORY_ID).replace(/\D/g, "");
        const [selectedKey, selectedCategoryId] = String(interaction.data.values?.[0] || "").split("|");
        try {
          const result = await createTicketChannel(env, interaction, selectedCategoryId || categoryId, selectedKey);
          if (result.unavailable) {
            return json({ type: 4, data: { content: `${result.label} n'est pas disponible pour le moment.`, flags: 64 } });
          }
          const panelConfig = panelKey === "academy"
            ? buildAcademyTicketPanelConfig({ category_id: categoryId })
            : { category_id: categoryId };
          if (selectedKey === "police-academy-rc" && result.channel_id) {
            ctx.waitUntil(resetTicketPanelMessage(env, interaction, panelConfig));
            return json(candidatureModalResponse(`candidature_modal|${result.channel_id}`.slice(0, 100)));
          }
          if (selectedKey === "cnu" && result.channel_id) {
            ctx.waitUntil(resetTicketPanelMessage(env, interaction, panelConfig));
            return json(cnuModalResponse(`cnu_modal|${result.channel_id}`.slice(0, 100)));
          }
          if (selectedKey === "swat" && result.channel_id) {
            ctx.waitUntil(resetTicketPanelMessage(env, interaction, panelConfig));
            return json(swatModalResponse(`swat_modal|${result.channel_id}`.slice(0, 100)));
          }
          return json({ type: 7, data: buildTicketPanelPayload(panelConfig) });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur ticket : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_close|")) {
        const [, requesterId, roleId = ""] = interaction.data.custom_id.split("|");
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const closeRoleIds = ticketRoleIdsFromValue(roleId);
        if (userId !== requesterId && !hasTicketAdminRole(interaction.member || {}, roleId)) {
          return json({ type: 4, data: { content: "Tu n'as pas l'autorisation de demander la fermeture de ce ticket.", flags: 64 } });
        }
        ctx.waitUntil((async () => {
          await setTicketRequesterVisibility(env, interaction.channel_id, requesterId, false);
        })());
        const roleLine = closeRoleIds.length ? closeRoleIds.map(id => `<@&${id}>`).join(" ") : "@staff";
        return json({
          type: 4,
          data: {
            content: roleLine,
            embeds: [{
              title: "🔒 Demande de fermeture",
              description: [
                `<@${requesterId}> ne voit plus ce ticket.`,
                "",
                "Un responsable du ticket doit confirmer la fermeture ou réouvrir le salon."
              ].join("\n"),
              color: 0xe67e22,
              footer: { text: TICKET_FOOTER_TEXT },
              timestamp: new Date().toISOString()
            }],
            components: [{
              type: 1,
              components: [
                { type: 2, style: 4, label: "Confirmer fermeture", emoji: { name: "✅" }, custom_id: `ticket_confirm_close|${requesterId}|${roleId}`.slice(0, 100) },
                { type: 2, style: 3, label: "Réouvrir le ticket", emoji: { name: "🔓" }, custom_id: `ticket_reopen|${requesterId}|${roleId}`.slice(0, 100) }
              ]
            }],
            allowed_mentions: { users: [requesterId], roles: closeRoleIds, parse: [] }
          }
        });
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_confirm_close|")) {
        const [, requesterId, roleId = ""] = interaction.data.custom_id.split("|");
        if (!hasTicketAdminRole(interaction.member || {}, roleId)) {
          return json({ type: 4, data: { content: "Action reservee aux responsables du ticket.", flags: 64 } });
        }
        ctx.waitUntil((async () => {
          await new Promise(resolve => setTimeout(resolve, 1200));
          await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
        })());
        return json({ type: 4, data: { content: "Fermeture confirmee. Le salon va etre supprime." } });
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("ticket_reopen|")) {
        const [, requesterId, roleId = ""] = interaction.data.custom_id.split("|");
        if (!hasTicketAdminRole(interaction.member || {}, roleId)) {
          return json({ type: 4, data: { content: "Action reservee aux responsables du ticket.", flags: 64 } });
        }
        try {
          await setTicketRequesterVisibility(env, interaction.channel_id, requesterId, true);
          return json({
            type: 7,
            data: {
              content: `<@${requesterId}>`,
              embeds: [{
                title: "🔓 Ticket réouvert",
                description: `<@${requesterId}> a de nouveau acces au ticket.`,
                color: 0x2ecc71,
                footer: { text: TICKET_FOOTER_TEXT },
                timestamp: new Date().toISOString()
              }],
              components: [],
              allowed_mentions: { users: [requesterId], parse: [] }
            }
          });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur reouverture : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      // Boutons location logements
      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("service_housing_location|")) {
        const gamme = interaction.data.custom_id.split("|")[1] === "haut" ? "haut" : "bas";
        try {
          const result = await createServiceHousingLiaison(env, interaction, gamme);
          return json({ type: 4, data: { content: `Liaison ouverte : <#${result.channel_id}>.`, flags: 64 } });
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur location : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("service_housing_close|")) {
        const requesterId = interaction.data.custom_id.split("|")[1];
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const member = interaction.member || {};
        if (userId !== requesterId && !hasStaffRole(member)) {
          return json({ type: 4, data: { content: "Tu n'as pas l'autorisation de fermer cette liaison.", flags: 64 } });
        }
        ctx.waitUntil((async () => {
          await new Promise(resolve => setTimeout(resolve, 1200));
          await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
        })());
        return json({ type: 4, data: { content: "Liaison fermee. Le salon va etre supprime.", flags: 64 } });
      }

      // Slash command /clear
      if (interaction.type === 2 && interaction.data.name === "clear") {
        const member = interaction.member || {};
        if (!hasStaffRole(member)) {
          return json({ type: 4, data: { content: "Tu n'as pas les permissions pour utiliser cette commande.", flags: 64 } });
        }

        const sub = (interaction.data.options || [])[0];
        if (!sub) {
          return json({ type: 4, data: { content: "Utilise `/clear messages nombre` ou `/clear all`.", flags: 64 } });
        }

        try {
          if (sub.name === "messages") {
            const count = sub.options?.find(o => o.name === "nombre")?.value || 1;
            const result = await deleteRecentChannelMessages(env, interaction.channel_id, count);
            return json({
              type: 4,
              data: {
                content: `Nettoyage termine : ${result.deleted} message${result.deleted > 1 ? "s" : ""} supprime${result.deleted > 1 ? "s" : ""}.` + (result.skipped ? ` ${result.skipped} non supprime(s).` : ""),
                flags: 64
              }
            });
          }

          if (sub.name === "all") {
            const result = await cloneAndDeleteChannel(env, interaction.guild_id, interaction.channel_id);
            return json({
              type: 4,
              data: {
                content: `Salon remis a zero : <#${result.new_channel_id}>.`,
                flags: 64
              }
            });
          }
        } catch (e) {
          return json({ type: 4, data: { content: `Erreur clear : ${String(e.message || e).slice(0, 1500)}`, flags: 64 } });
        }

        return json({ type: 4, data: { content: "Mode clear inconnu.", flags: 64 } });
      }

      // Slash command /defcon
      if (interaction.type === 2 && interaction.data.name === "defcon") {
        const member = interaction.member || {};
        if (!memberHasAnyRole(member, DEFCON_ALLOWED_ROLE_IDS)) {
          return json({ type: 4, data: { content: "Tu n'as pas les permissions pour utiliser cette commande.", flags: 64 } });
        }

        const options = interaction.data.options || [];
        const level = String(options.find(o => o.name === "niveau")?.value || "");
        const imageUrl = DEFCON_IMAGE_URLS[level];

        if (!imageUrl) {
          return json({ type: 4, data: { content: "Niveau DEFCON invalide. Choisis 1, 2, 3, 4 ou 5.", flags: 64 } });
        }

        const userId = interaction.member?.user?.id || interaction.user?.id || "";
        await renameDefconStatusChannel(env, level);

        return json({
          type: 4,
          data: {
            content: `<@&${DEFCON_PING_ROLE_ID}>`,
            embeds: [
              {
                title: `Alerte DEFCON ${level}`,
                description: `Niveau DEFCON ${level} publie par ${userId ? `<@${userId}>` : "le commandement"}.`,
                color: DEFCON_COLORS[level] || TICKET_PANEL_ACCENT_COLOR,
                image: { url: imageUrl },
                footer: { text: TICKET_FOOTER_TEXT },
                timestamp: new Date().toISOString()
              }
            ],
            allowed_mentions: { parse: [], roles: [DEFCON_PING_ROLE_ID] }
          }
        });
      }

      // Slash command /message
      if (interaction.type === 2 && interaction.data.name === "message") {
        const member = interaction.member || {};
        if (!hasStaffRole(member)) {
          return json({ type: 4, data: { content: "Tu n'as pas les permissions pour utiliser cette commande.", flags: 64 } });
        }

        const options = interaction.data.options || [];
        const channelId = interaction.channel_id;
        const text = String(options.find(o => o.name === "texte")?.value || "").trim();

        if (!text) {
          return json({ type: 4, data: { content: "Texte manquant.", flags: 64 } });
        }
        if (text.length > 2000) {
          return json({ type: 4, data: { content: "Message trop long : limite Discord 2000 caracteres.", flags: 64 } });
        }

        const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: text,
            allowed_mentions: { parse: ["users", "roles", "everyone"] }
          })
        });

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return json({ type: 4, data: { content: `Impossible d'envoyer le message (${res.status}) : ${err.slice(0, 500)}`, flags: 64 } });
        }

        const sent = await res.json().catch(() => ({}));
        const link = sent.id ? `\nhttps://discord.com/channels/${interaction.guild_id}/${channelId}/${sent.id}` : "";
        return json({ type: 4, data: { content: `Message envoye dans <#${channelId}>.${link}`, flags: 64 } });
      }

      // Slash command /subvention
      if (interaction.type === 2 && interaction.data.name === "subvention") {
        return json(subventionModalResponse());
      }

      // Slash command /candidature
      if (interaction.type === 2 && interaction.data.name === "candidature") {
        return json(candidatureModalResponse());
      }

      // Slash command /heures
      if (interaction.type === 2 && interaction.data.name === "heures") {
        const siteKey = siteKeyFromGuildId(interaction.guild_id);
        let agent;
        try {
          agent = await getAgentForPointeuseInteraction(env, interaction, siteKey);
        } catch (e) {
          return json({ type: 4, data: { content: `❌ Erreur agent : ${e.message}`, flags: 64 } });
        }
        if (!agent) {
          return json({ type: 4, data: { content: "❌ Ton Discord ID n'est lié à aucun agent. Configure-le dans ton profil sur l'intranet ou vérifie ton pseudo Discord.", flags: 64 } });
        }

        const summary = await getWeeklyServiceSummary(env, agent, siteKey);
        const weekStartUnix = Math.floor(summary.weekStart.getTime() / 1000);
        const nowUnix = Math.floor(Date.now() / 1000);
        const active = await getActivePointagesForAgentIdentity(env, agent, siteKey);
        const sessionLines = summary.sessions.slice(-5).map(p => {
          const start = Math.floor(new Date(p.clock_in).getTime() / 1000);
          const end = p.clock_out ? Math.floor(new Date(p.clock_out).getTime() / 1000) : null;
          return `• <t:${start}:f> → ${end ? `<t:${end}:t>` : "en cours"} · **${formatDurationFromMs(p.durationMs)}**`;
        }).join("\n") || "Aucun service enregistré cette semaine.";

        return json({
          type: 4,
          data: {
            flags: 64,
            embeds: [{
              title: "🕒 Mes heures de service",
              description: `Bilan personnel de **${agent.prenom} ${agent.nom}** (${agent.matricule || "—"})`,
              color: 0xd6b342,
              fields: [
                { name: "Semaine", value: `<t:${weekStartUnix}:D> → <t:${nowUnix}:f>`, inline: false },
                { name: "Grade", value: agent.grade || "Non renseigné", inline: true },
                { name: "Tarif horaire", value: summary.hourlyRate ? formatMoney(summary.hourlyRate) : "Non configuré", inline: true },
                { name: "Statut", value: active.length ? "En service actuellement" : "Hors service", inline: true },
                { name: "Total heures", value: `**${formatDurationFromMs(summary.totalMs)}**`, inline: true },
                { name: "Paie estimée", value: `**${formatMoney(summary.pay)}**`, inline: true },
                { name: "Services récents", value: sessionLines.slice(0, 1024), inline: false }
              ],
              footer: { text: `${siteKey === "nord" ? "SASP Nord" : "SASP Sud"} · Pointeuse` },
              timestamp: new Date().toISOString()
            }]
          }
        });
      }

      if (interaction.type === 3 && interaction.data.custom_id?.startsWith("subvention_decision|")) {
        const member = interaction.member || {};
        if (!hasStaffRole(member)) {
          return json({ type: 4, data: { content: "Tu n'as pas l'autorisation de valider ou refuser une subvention.", flags: 64 } });
        }
        const [, decision] = interaction.data.custom_id.split("|");
        const accepted = decision === "accept";
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const originalEmbed = interaction.message?.embeds?.[0] || {};
        const fields = (originalEmbed.fields || []).filter(field => !String(field.name || "").toLowerCase().includes("decision"));
        fields.push({
          name: "Decision",
          value: `${accepted ? "✅ Acceptee" : "❌ Refusee"} par <@${userId}>`,
          inline: false
        });
        const components = (interaction.message?.components || []).map(row => ({
          ...row,
          components: (row.components || []).map(component => ({ ...component, disabled: true }))
        }));
        return json({
          type: 7,
          data: {
            content: interaction.message?.content || "",
            embeds: [{
              ...originalEmbed,
              title: `${accepted ? "✅" : "❌"} Demande de subvention`,
              color: accepted ? 0x2ecc71 : 0xe74c3c,
              fields,
              timestamp: new Date().toISOString()
            }],
            components,
            allowed_mentions: { users: [userId], roles: ["1500975725153620033"] }
          }
        });
      }

      if (interaction.type === 3 && interaction.data.custom_id === "subvention_open_modal") {
        return json(subventionModalResponse());
      }

      // Modal submit /subvention
      if (interaction.type === 5 && interaction.data.custom_id === "subvention_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const raison    = getValue("sub_raison");
        const somme     = getValue("sub_somme");
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const identity = await getAgentIdentityForInteraction(env, interaction);
        const agentName = `${identity.prenom || ""} ${identity.nom || ""}`.trim() || `<@${userId}>`;
        const sourceLabel = identity.source === "fiche" ? "fiche intranet" : "pseudo Discord";
        const now = new Date();
        const fields = [
          { name: "ðŸ’° Somme", value: somme, inline: true },
          { name: "ðŸ“¨ DemandÃ© par", value: `<@${userId}>`, inline: true },
          { name: "ðŸ”Ž Source identitÃ©", value: sourceLabel, inline: true }
        ];
        if (identity.iban) fields.push({ name: "IBAN", value: String(identity.iban).slice(0, 1024), inline: false });
        fields.push({ name: "ðŸ“‹ Raison", value: raison.slice(0, 1024), inline: false });
        const res = await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "<@&1500975725153620033>",
            embeds: [{
              title: "ðŸ’¸ Demande de subvention",
              color: 0x3498db,
              fields,
              footer: { text: "SASP â€¢ Subvention" },
              timestamp: now.toISOString()
            }],
            components: [{
              type: 1,
              components: [
                { type: 2, style: 3, label: "Accepter", emoji: { name: "âœ…" }, custom_id: `subvention_decision|accept|${userId}` },
                { type: 2, style: 4, label: "Refuser", emoji: { name: "âŒ" }, custom_id: `subvention_decision|refuse|${userId}` }
              ]
            }]
          })
        });
        if (!res.ok) {
          const err = await res.text();
          return json({ type: 4, data: { content: `âŒ Erreur crÃ©ation subvention (${res.status}): ${err}`, flags: 64 } });
        }
        return json({ type: 4, data: { content: `âœ… Demande de subvention envoyÃ©e pour **${agentName}**.`, flags: 64 } });
      }

      // Modal submit /candidature
      if (interaction.type === 5 && interaction.data.custom_id?.startsWith("candidature_modal")) {
        const [, targetChannelIdRaw = ""] = interaction.data.custom_id.split("|");
        const targetChannelId = String(targetChannelIdRaw || "").replace(/\D/g, "");
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const telephone = getValue("cand_telephone").trim();
        const disponibilite = getValue("cand_disponibilite").trim();
        const experience = getValue("cand_experience").trim();
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let identity = {};
        try { identity = await getAgentIdentityForInteraction(env, interaction); } catch {}
        const displayName = `${identity.prenom || ""} ${identity.nom || ""}`.trim()
          || interaction.member?.nick
          || interaction.member?.user?.global_name
          || interaction.member?.user?.username
          || "Candidat";

        const candidaturePayload = {
          content: `<@${userId}>`,
          embeds: [{
            title: "🎓 Recrutement SASP",
            description: [
              `Candidature envoy\u00e9e par **${displayName}**.`,
              "",
              "📎 Merci d'envoyer \u00e0 la suite dans ce salon :",
              "• une **carte d'identit\u00e9**",
              "• un **permis**"
            ].join("\n"),
            color: 0x0b2f4a,
            fields: [
              { name: "📞 Num\u00e9ro de t\u00e9l\u00e9phone", value: telephone.slice(0, 1024) || "Non renseign\u00e9", inline: false },
              { name: "🕒 Disponibilit\u00e9", value: disponibilite.slice(0, 1024) || "Non renseign\u00e9e", inline: false },
              { name: "📋 Exp\u00e9rience pass\u00e9e", value: experience.slice(0, 1024) || "Non renseign\u00e9e", inline: false }
            ],
            footer: { text: "SASP - Police Academy" },
            timestamp: new Date().toISOString()
          }],
          allowed_mentions: { users: [userId], parse: [] }
        };

        if (targetChannelId) {
          const res = await discordFetch(`${DISCORD_API}/channels/${targetChannelId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(candidaturePayload)
          });
          if (!res.ok) {
            const err = await res.text();
            return json({ type: 4, data: { content: `Erreur candidature (${res.status}) : ${err.slice(0, 1200)}`, flags: 64 } });
          }
          return json({
            type: 4,
            data: {
              content: `✅ Candidature envoy\u00e9e dans <#${targetChannelId}>. Pense \u00e0 ajouter ta carte d'identit\u00e9 et ton permis dans le ticket.`,
              flags: 64
            }
          });
        }

        return json({ type: 4, data: candidaturePayload });
      }

      // Modal submit / CNU
      if (interaction.type === 5 && interaction.data.custom_id?.startsWith("cnu_modal")) {
        const [, targetChannelIdRaw = ""] = interaction.data.custom_id.split("|");
        const targetChannelId = String(targetChannelIdRaw || "").replace(/\D/g, "");
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let identity = {};
        try { identity = await getAgentIdentityForInteraction(env, interaction); } catch {}
        const displayName = `${identity.prenom || ""} ${identity.nom || ""}`.trim()
          || interaction.member?.nick
          || interaction.member?.user?.global_name
          || interaction.member?.user?.username
          || "Candidat";
        const payload = {
          content: `<@${userId}>`,
          embeds: [{
            title: "🤝 Candidature Crisis Negotiation Unit",
            description: `Formulaire CNU envoyé par **${displayName}**.`,
            color: 0x0b2f4a,
            fields: [
              { name: "📞 Numéro de téléphone", value: getValue("cnu_telephone").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "🎓 Formations CNU déjà suivies", value: getValue("cnu_formations").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "🎯 Poste souhaité", value: getValue("cnu_poste").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "🧠 Expérience en négociation de crise", value: getValue("cnu_experience").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "📝 Motivation", value: getValue("cnu_motivation").trim().slice(0, 1024) || "Non renseigné", inline: false }
            ],
            footer: { text: "SASP - Crisis Negotiation Unit" },
            timestamp: new Date().toISOString()
          }],
          allowed_mentions: { users: [userId], parse: [] }
        };
        if (targetChannelId) {
          const res = await discordFetch(`${DISCORD_API}/channels/${targetChannelId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!res.ok) return json({ type: 4, data: { content: `Erreur formulaire CNU (${res.status}) : ${(await res.text()).slice(0, 1200)}`, flags: 64 } });
          return json({ type: 4, data: { content: `✅ Formulaire CNU envoyé dans <#${targetChannelId}>.`, flags: 64 } });
        }
        return json({ type: 4, data: payload });
      }

      // Modal submit / SWAT
      if (interaction.type === 5 && interaction.data.custom_id?.startsWith("swat_modal")) {
        const [, targetChannelIdRaw = ""] = interaction.data.custom_id.split("|");
        const targetChannelId = String(targetChannelIdRaw || "").replace(/\D/g, "");
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let identity = {};
        try { identity = await getAgentIdentityForInteraction(env, interaction); } catch {}
        const displayName = `${identity.prenom || ""} ${identity.nom || ""}`.trim()
          || interaction.member?.nick
          || interaction.member?.user?.global_name
          || interaction.member?.user?.username
          || "Candidat";
        const payload = {
          content: `<@${userId}>`,
          embeds: [{
            title: "⚔️ Candidature Special Weapons And Tactics",
            description: `Formulaire SWAT envoyé par **${displayName}**.`,
            color: 0x0b2f4a,
            fields: [
              { name: "🏷️ Ancienne / actuelle affectation", value: getValue("swat_affectation").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "👮 Expérience dans les forces de l'ordre", value: getValue("swat_experience_lo").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "🚨 Interventions à haut risque", value: getValue("swat_risque").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "🛡️ Unités spécialisées", value: getValue("swat_unites").trim().slice(0, 1024) || "Non renseigné", inline: false },
              { name: "📝 Motivation et objectifs", value: getValue("swat_motivation").trim().slice(0, 1024) || "Non renseigné", inline: false }
            ],
            footer: { text: "SASP - Special Weapons And Tactics" },
            timestamp: new Date().toISOString()
          }],
          allowed_mentions: { users: [userId], parse: [] }
        };
        if (targetChannelId) {
          const res = await discordFetch(`${DISCORD_API}/channels/${targetChannelId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!res.ok) return json({ type: 4, data: { content: `Erreur formulaire SWAT (${res.status}) : ${(await res.text()).slice(0, 1200)}`, flags: 64 } });
          return json({ type: 4, data: { content: `✅ Formulaire SWAT envoyé dans <#${targetChannelId}>.`, flags: 64 } });
        }
        return json({ type: 4, data: payload });
      }

      if (interaction.type === 5 && interaction.data.custom_id.startsWith("ftf_convocation_modal|")) {
        const dossierId = interaction.data.custom_id.split("|")[1];
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const date = getValue("ftf_convocation_date").trim();
        const heure = getValue("ftf_convocation_hour").trim();
        if (!date || !heure) {
          return json({ type: 4, data: { content: "Date et heure obligatoires.", flags: 64 } });
        }
        const dossier = await getFtfDossier(env, dossierId);
        if (!dossier) return json({ type: 4, data: { content: "Dossier FTF introuvable.", flags: 64 } });
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const suspect = `${dossier.prenom || ""} ${dossier.nom || ""}`.trim() || "Suspect";
        const updated = {
          ...dossier,
          convocation_validee: true,
          convocation_date: date,
          convocation_heure: heure,
          convocation_planifiee_par: userId,
          updated_at: new Date().toISOString()
        };
        await upsertFtfDossier(env, updated);
        await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: `<@${userId}> a planifie la convocation FTF de **${suspect}** le **${date}** a **${heure}**.\nGenere ensuite le PNG depuis le dossier FTF sur l'intranet.`,
            allowed_mentions: { users: [userId] }
          })
        });
        return json({ type: 4, data: { content: "Convocation planifiee et rappels arretes pour ce dossier.", flags: 64 } });
      }

      // Slash command /proc
      if (interaction.type === 2 && interaction.data.name === "proc") {
        if (![BRACELET_COMMAND_CHANNEL, NORD_COMMAND_CHANNEL].includes(interaction.channel_id)) {
          return json({ type: 4, data: { content: `âŒ Utilise cette commande dans <#${BRACELET_COMMAND_CHANNEL}> ou <#${NORD_COMMAND_CHANNEL}>.`, flags: 64 } });
        }
        return json({
          type: 9,
          data: {
            custom_id: "proc_modal",
            title: "Demande Procureur",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "suspect", label: "Nom PrÃ©nom du suspect", style: 1, required: true, placeholder: "Ex : John Smith", min_length: 2, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "rapport_arrestation", label: "ID du rapport d'arrestation", style: 1, required: true, placeholder: "Ex : 1234 ou #1234", max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "chefs_accusation", label: "Chef(s) d'accusation", style: 2, required: true, placeholder: "Ex : Outrage, refus d'obtempÃ©rer...", min_length: 2, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: "heure_interpellation", label: "Heure/date interpellation", style: 1, required: true, placeholder: "Ex : 10/07/2026 17:30", max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "tel_suspect", label: "TÃ©lÃ©phone du suspect", style: 1, required: true, placeholder: "Ex : 555-0123", max_length: 80 }] }
            ]
          }
        });
      }

      // Modal submit /proc
      if (interaction.type === 5 && interaction.data.custom_id.startsWith("proc_modal")) {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const suspect         = getValue("suspect");
        const rapportArrestation = (getValue("rapport_arrestation") || "Non renseignÃ©").replace(/^#/, "");
        const chefsAccusation = (getValue("chefs_accusation") || "Non renseignÃ©").slice(0, 500);
        const heureInterpellation = getValue("heure_interpellation") || "Non renseignÃ©";
        const telSuspect = getValue("tel_suspect") || "Non renseignÃ©";

        const now = new Date();
        const dateStr = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const origin = getSaspOrigin(interaction);
        const threadTitle = `[${origin.label}] ${suspect} - ${dateStr} - ${heureInterpellation}`;

        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const procContent =
          `<@&1512185605805703188>\n\n` +
          `**Origine :** ${origin.label}\n\n` +
          `Nous sollicitons l'intervention d'un procureur concernant une affaire n\u00e9cessitant une validation judiciaire.\n\n` +
          `**Suspect :** ${suspect}\n\n` +
          `**Chef(s) d'accusation :** ${chefsAccusation}\n\n` +
          `**Rapport d'arrestation :** #${rapportArrestation}\n\n` +
          `**Agent en charge :** ${agentDisplay}\n\n` +
          `**Heure et date de l'interpellation :** ${heureInterpellation}\n\n` +
          `**Num\u00e9ros de tel. du suspect :** ${telSuspect}\n` +
          `\n` +
          `Nous sommes actuellement dans l'attente d'une d\u00e9cision du bureau du procureur concernant cette proc\u00e9dure. Merci de bien vouloir prendre connaissance du dossier et nous communiquer vos instructions d\u00e8s que possible.`;

        const procUtilityComponents = [
            { type: 1, components: [
              { type: 2, style: 1, label: "ðŸ”— Bracelet Ã‰lectronique", custom_id: "proc_bracelet" },
              { type: 2, style: 2, label: "âš–ï¸ Ajouter avocat", custom_id: "proc_add_avocat" }
            ] }
        ];
        const procDecisionComponents = [
            { type: 1, components: [
              { type: 2, style: 3, label: "âœ… Affaire clÃ´turÃ©e",   custom_id: "proc_tag|AFFAIRE CLOTURER" },
              { type: 2, style: 4, label: "ðŸš« Dossier incomplet",  custom_id: "proc_tag|DOSSIER INCOMPLET" },
              { type: 2, style: 2, label: "ðŸ”„ Affaire en cours",   custom_id: "proc_tag|AFFAIRE EN COUR" }
            ]},
            { type: 1, components: [
              { type: 2, style: 2, label: "âš–ï¸ Attente jugement",   custom_id: "proc_tag|ATTENTE DE JUGEMENT" },
              { type: 2, style: 2, label: "â³ Attente procureur",  custom_id: "proc_tag|ATTENTE PROCUREUR" }
            ]}
        ];
        const procMessage = { content: procContent, components: procUtilityComponents };
        const procResults = [];
        const procErrors = [];
        for (const dest of getProcDestinations(interaction)) {
          try {
            const originTagIds = await ensureForumTags(dest.procForum, [origin.label]);
            const data = await createForumThread(
              dest.procForum,
              threadTitle,
              dest.key === "doj" ? { ...procMessage, components: procUtilityComponents.concat(procDecisionComponents) } : procMessage,
              originTagIds
            );
            procResults.push({ label: dest.label, id: data.id });
          } catch (e) {
            procErrors.push(`${dest.label}: ${e.message}`);
          }
        }
        if (!procResults.length) return json({ type: 4, data: { content: `âŒ Erreur crÃ©ation forum : ${procErrors.join(" | ")}`, flags: 64 } });
        await discordFetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "âš–ï¸ Nouvelle demande procureur", color: 0x2c3e50, fields: [
            { name: "Origine", value: origin.label, inline: true },
            { name: "ðŸ§‘ Suspect", value: suspect, inline: true },
            { name: "ðŸ“ž TÃ©lÃ©phone", value: telSuspect, inline: true },
            { name: "ðŸ“„ Rapport", value: `#${rapportArrestation}`, inline: true },
            { name: "ðŸ“‹ Chef(s) d'accusation", value: chefsAccusation, inline: false },
            { name: "ðŸ‘® Agent en charge", value: agentDisplay, inline: true },
            { name: "ðŸ• Interpellation", value: heureInterpellation, inline: true }
          ], footer: { text: "SASP Â· Proc" }, timestamp: now.toISOString() }] })
        });
        const procLinks = procResults.map(r => `**${r.label}** <#${r.id}>`).join(" | ");
        const procWarn = procErrors.length ? `\nâš ï¸ Non envoyÃ© : ${procErrors.join(" | ")}` : "";
        return json({ type: 4, data: { content: `âœ… Demande procureur crÃ©Ã©e pour **${suspect}** : ${procLinks}${procWarn}`, flags: 64 } });
      }

      // Slash command /bracelet standalone
      if (interaction.type === 2 && interaction.data.name === "bracelet") {
        if (![BRACELET_COMMAND_CHANNEL, NORD_COMMAND_CHANNEL].includes(interaction.channel_id)) {
          return json({ type: 4, data: { content: `âŒ Utilise cette commande dans <#${BRACELET_COMMAND_CHANNEL}> ou <#${NORD_COMMAND_CHANNEL}>.`, flags: 64 } });
        }
        const now = new Date();
        const dateDefault = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        return json({
          type: 9,
          data: {
            custom_id: "bracelet_standalone_modal",
            title: "Bracelet Ã‰lectronique",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "bracelet_suspect", label: "Nom PrÃ©nom du suspect", style: 1, required: true, placeholder: "Ex : Morrison James", max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_date", label: "PosÃ© le", style: 1, required: true, value: dateDefault, max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_tel", label: "NumÃ©ro de tÃ©lÃ©phone", style: 1, required: true, placeholder: "Ex : 555-0198", max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_raison", label: "Chef(s) d'inculpation", style: 2, required: true, placeholder: "Infractions retenuesâ€¦", max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_dossier", label: "# du dossier", style: 1, required: false, placeholder: "Ex : 2026-0042", max_length: 50 }] }
            ]
          }
        });
      }

      // Modal submit bracelet standalone (sans proc)
      if (interaction.type === 5 && interaction.data.custom_id === "bracelet_standalone_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const suspect = getValue("bracelet_suspect");
        const date    = getValue("bracelet_date");
        const tel     = getValue("bracelet_tel");
        const raison  = getValue("bracelet_raison");
        const dossier = getValue("bracelet_dossier");

        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const origin = getSaspOrigin(interaction);
        const dossierLine = dossier ? `\nN\u00b0 Dossier : ${dossier}` : "";
        const content = `BRACELET ELECTRONIQUE DE ${suspect.toUpperCase()}\n\nOrigine : ${origin.label}\nPos\u00e9 le : ${date}\nNum\u00e9ro de t\u00e9l\u00e9phone : ${tel}${dossierLine}\nRaison : ${raison}\nPos\u00e9 par : ${agentDisplay}\n\nPensez \u00e0 bien noter quand les individus viennent pointer\n\n\u2139\ufe0f Les bracelets peuvent \u00eatre activ\u00e9s pour voir la position une fois toutes les 24h via un message "BIP" sur le t\u00e9l\u00e9phone de l'individu.`;

        const braceletMessage = {
          content,
          components: [
            { type: 1, components: [{ type: 2, style: 3, label: "ðŸ“ Pointage", custom_id: "bracelet_pointage" }] }
          ]
        };
        const braceletResults = [];
        const braceletErrors = [];
        for (const dest of getBraceletDestinations()) {
          try {
            const originTagIds = await ensureForumTags(dest.braceletForum, [origin.label]);
            const data = await createForumThread(dest.braceletForum, braceletTitle(origin.label, suspect), braceletMessage, originTagIds);
            braceletResults.push({ label: dest.label, id: data.id });
          } catch (e) {
            braceletErrors.push(`${dest.label}: ${e.message}`);
          }
        }
        if (!braceletResults.length) return json({ type: 4, data: { content: `âŒ Erreur crÃ©ation bracelet : ${braceletErrors.join(" | ")}`, flags: 64 } });
        const braceletLinks = braceletResults.map(r => `**${r.label}** <#${r.id}>`).join(" | ");
        const braceletWarn = braceletErrors.length ? `\nâš ï¸ Non envoyÃ© : ${braceletErrors.join(" | ")}` : "";
        return json({ type: 4, data: { content: `âœ… Bracelet Ã©lectronique crÃ©Ã© pour **${suspect}** : ${braceletLinks}${braceletWarn}`, flags: 64 } });
      }

      // Bouton avocat depuis un post proc
      if (interaction.type === 3 && interaction.data.custom_id === "proc_add_avocat") {
        return json({
          type: 9,
          data: {
            custom_id: "proc_avocat_modal",
            title: "Ajouter avocat",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "proc_avocat_nom", label: "Avocat en charge", style: 1, required: true, placeholder: "Ex : Me. Dupont", max_length: 100 }] },
              { type: 1, components: [{ type: 4, custom_id: "proc_avocat_tel", label: "NumÃ©ro de tel. avocat", style: 1, required: true, placeholder: "Ex : 555-0456", max_length: 60 }] }
            ]
          }
        });
      }

      // Modal avocat depuis un post proc
      if (interaction.type === 5 && interaction.data.custom_id === "proc_avocat_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const avocat = getValue("proc_avocat_nom");
        const telAvocat = getValue("proc_avocat_tel");
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        let threadName = "";
        try {
          const threadInfoRes = await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (threadInfoRes.ok) {
            const threadInfo = await threadInfoRes.json();
            threadName = threadInfo.name || "";
          }
        } catch {}

        const threadIds = new Set([interaction.channel_id]);
        if (threadName) {
          for (const id of await findActiveProcCopies(threadName)) threadIds.add(id);
        }

        const updated = [];
        const errors = [];
        for (const threadId of threadIds) {
          try {
            if (await updateProcLawyerInThread(threadId, avocat, telAvocat)) updated.push(threadId);
          } catch (e) {
            errors.push(`${threadId}: ${e.message}`);
          }
        }
        if (!updated.length) {
          return json({ type: 4, data: { content: `âŒ Impossible de modifier le dossier procureur.${errors.length ? `\n${errors.join("\n").slice(0, 1500)}` : ""}`, flags: 64 } });
        }

        await discordFetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "âš–ï¸ Avocat ajoutÃ© au dossier procureur", color: 0x2c3e50, fields: [
            { name: "âš–ï¸ Avocat", value: avocat, inline: true },
            { name: "ðŸ“ž TÃ©lÃ©phone", value: telAvocat, inline: true },
            { name: "ðŸ‘® AjoutÃ© par", value: agentDisplay, inline: false },
            { name: "ðŸ“ Copies modifiÃ©es", value: `${updated.length}`, inline: true }
          ], footer: { text: "SASP Â· Proc" }, timestamp: new Date().toISOString() }] })
        });

        const warn = errors.length ? `\nâš ï¸ Certaines copies n'ont pas Ã©tÃ© modifiÃ©es.` : "";
        return json({ type: 4, data: { content: `âœ… Avocat ajoutÃ© dans le message du dossier et ses copies (${updated.length}).${warn}`, flags: 64 } });
      }

      // Bouton bracelet depuis un post proc
      if (interaction.type === 3 && interaction.data.custom_id === "proc_bracelet") {
        const content = interaction.message?.content || "";
        const modalValue = (value, max) => {
          const clean = String(value || "").replace(/\s+/g, " ").trim();
          return clean.length > max ? clean.slice(0, max) : clean;
        };
        const modalInput = ({ custom_id, label, style = 1, required = true, value, placeholder, max_length }) => {
          const input = { type: 4, custom_id, label, style, required, max_length };
          const cleanValue = modalValue(value, max_length);
          if (cleanValue) input.value = cleanValue;
          if (placeholder) input.placeholder = placeholder;
          return { type: 1, components: [input] };
        };
        const getProcTextField = (label) => {
          const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const match = content.match(new RegExp(`\\*\\*${escaped}\\s*:?\\*\\*\\s*([\\s\\S]*?)(?=\\n\\n\\*\\*|$)`, "i"));
          return match ? match[1].trim() : "";
        };
        const suspectName = getProcTextField("Suspect");
        const telSuspect  = getProcTextField("Num\u00e9ros de tel. du suspect");
        const chefs       = getProcTextField("Chef(s) d'accusation");
        const originLabel = getProcTextField("Origine") || getSaspOrigin(interaction).label;
        const originToken = String(originLabel).toUpperCase().includes("NORD") ? "nord" : "sud";
        const now = new Date();
        const dateDefault = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        return json({
          type: 9,
          data: {
            custom_id: `bracelet_modal|${originToken}`,
            title: "Bracelet Ã‰lectronique",
            components: [
              modalInput({ custom_id: "bracelet_suspect", label: "Nom PrÃ©nom du suspect", value: suspectName, max_length: 80 }),
              modalInput({ custom_id: "bracelet_date", label: "PosÃ© le", value: dateDefault, max_length: 30 }),
              modalInput({ custom_id: "bracelet_tel", label: "NumÃ©ro de tÃ©lÃ©phone", value: telSuspect, max_length: 30 }),
              modalInput({ custom_id: "bracelet_raison", label: "Chef(s) d'inculpation", style: 2, value: chefs, max_length: 500 }),
              modalInput({ custom_id: "bracelet_accord_proc", label: "Demande procureur", placeholder: "Oui ou Non", max_length: 3 })
            ]
          }
        });
      }

      // Modal submit bracelet
      if (interaction.type === 5 && interaction.data.custom_id.startsWith("bracelet_modal")) {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const suspect = getValue("bracelet_suspect");
        const date    = getValue("bracelet_date");
        const tel     = getValue("bracelet_tel");
        const raison  = getValue("bracelet_raison");
        const accordProc = getValue("bracelet_accord_proc") || "Non";
        const originToken = interaction.data.custom_id.split("|")[1] || "";
        const originLabel = originToken === "nord" ? "SASP NORD" : originToken === "sud" ? "SASP SUD" : originToken ? decodeURIComponent(originToken) : getSaspOrigin(interaction).label;

        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const procThreadId = interaction.channel_id;
        const content = `BRACELET ELECTRONIQUE DE ${suspect.toUpperCase()}\n\nOrigine : ${originLabel}\nDossier proc li\u00e9 : <#${procThreadId}>\n\nPos\u00e9 le : ${date}\nNum\u00e9ro de t\u00e9l\u00e9phone : ${tel}\nRaison : ${raison}\nDemande procureur : ${accordProc}\nPos\u00e9 par : ${agentDisplay}\n\nPensez \u00e0 bien noter quand les individus viennent pointer\n\n\u2139\ufe0f Les bracelets peuvent \u00eatre activ\u00e9s pour voir la position une fois toutes les 24h via un message "BIP" sur le t\u00e9l\u00e9phone de l'individu.`;

        const braceletMessage = {
          content,
          components: [
            { type: 1, components: [{ type: 2, style: 3, label: "ðŸ“ Pointage", custom_id: "bracelet_pointage" }] }
          ]
        };
        const braceletResults = [];
        const braceletErrors = [];
        for (const dest of getBraceletDestinations()) {
          try {
            const originTagIds = await ensureForumTags(dest.braceletForum, [originLabel]);
            const data = await createForumThread(dest.braceletForum, braceletTitle(originLabel, suspect), braceletMessage, originTagIds);
            braceletResults.push({ label: dest.label, id: data.id });
          } catch (e) {
            braceletErrors.push(`${dest.label}: ${e.message}`);
          }
        }
        if (!braceletResults.length) return json({ type: 4, data: { content: `âŒ Erreur crÃ©ation bracelet : ${braceletErrors.join(" | ")}`, flags: 64 } });
        const braceletLinks = braceletResults.map(r => `**${r.label}** <#${r.id}>`).join(" | ");
        // Poster le lien du bracelet dans le thread proc pour relier les deux
        await discordFetch(`${DISCORD_API}/channels/${procThreadId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: `ðŸ”— Bracelet crÃ©Ã© : ${braceletLinks}` })
        });
        await discordFetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "ðŸ”— Bracelet Ã©lectronique posÃ©", color: 0xe67e22, fields: [
            { name: "Origine", value: originLabel, inline: true },
            { name: "ðŸ§‘ Suspect", value: suspect, inline: true },
            { name: "ðŸ“ž TÃ©lÃ©phone", value: tel, inline: true },
            { name: "ðŸ“‹ Chef(s) d'inculpation", value: raison, inline: false },
            { name: "Demande procureur", value: accordProc, inline: true },
            { name: "ðŸ“… PosÃ© le", value: date, inline: true },
            { name: "ðŸ‘® PosÃ© par", value: agentDisplay, inline: true }
          ], footer: { text: "SASP Â· Bracelet" }, timestamp: new Date().toISOString() }] })
        });
        const braceletWarn = braceletErrors.length ? `\nâš ï¸ Non envoyÃ© : ${braceletErrors.join(" | ")}` : "";
        return json({ type: 4, data: { content: `âœ… Bracelet Ã©lectronique crÃ©Ã© pour **${suspect}** : ${braceletLinks}${braceletWarn}`, flags: 64 } });
      }

      // Boutons tags proc/bracelet
      if (interaction.type === 3 && interaction.data.custom_id.startsWith("proc_tag|")) {
        const TAG_ALLOWED_ROLES = ["1512410095173238814", "1500975725153620033", "1504452141518032956"];
        const memberRoles = interaction.member?.roles || [];
        if (!TAG_ALLOWED_ROLES.some(r => memberRoles.includes(r))) {
          return json({ type: 4, data: { content: "âŒ Tu n'as pas la permission de modifier le statut de ce dossier.", flags: 64 } });
        }

        const tagName = interaction.data.custom_id.split("|")[1];
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const tagMessages = {
          'AFFAIRE CLOTURER':    'ðŸ”’ **Affaire clÃ´turÃ©e.**',
          'DOSSIER INCOMPLET':   'âš ï¸ **Dossier incomplet** â€” des informations sont manquantes.',
          'AFFAIRE EN COUR':     'ðŸ”„ **Affaire en cours** de traitement.',
          'ATTENTE DE JUGEMENT': 'âš–ï¸ **En attente de jugement.**',
          'ATTENTE PROCUREUR':   'â³ **En attente du procureur.**'
        };
        const msg = tagMessages[tagName] || `**${tagName}**`;
        const now = new Date();
        let threadName = "";
        try {
          const threadInfoRes = await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          if (threadInfoRes.ok) {
            const threadInfo = await threadInfoRes.json();
            threadName = threadInfo.name || "";
          }
        } catch {}

        const applyTagAndMessage = async (threadId) => {
          try {
            const threadInfo = await (await discordFetch(`${DISCORD_API}/channels/${threadId}`, { headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` } })).json();
            const forumInfo  = await (await discordFetch(`${DISCORD_API}/channels/${threadInfo.parent_id}`, { headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` } })).json();
            const tag = (forumInfo.available_tags || []).find(t => t.name.toUpperCase() === tagName.toUpperCase());
            if (tag) {
              await discordFetch(`${DISCORD_API}/channels/${threadId}`, {
                method: "PATCH",
                headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ applied_tags: [tag.id] })
              });
            }
          } catch {}
          await discordFetch(`${DISCORD_API}/channels/${threadId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content: `${msg} â€” par ${agentDisplay}` })
          });
        };

        const procThreadIds = new Set([interaction.channel_id]);
        if (threadName) {
          for (const id of await findActiveProcCopies(threadName)) procThreadIds.add(id);
        }

        // Applique sur toutes les copies proc retrouvees
        for (const procThreadId of procThreadIds) {
          await applyTagAndMessage(procThreadId);
        }
        if (tagName === "AFFAIRE CLOTURER") {
          for (const procThreadId of procThreadIds) {
            try { await closeDiscordThread(procThreadId); } catch {}
          }
        }

        // Cherche les bracelets lies depuis toutes les copies proc et propage
        try {
          const braceletThreadIds = new Set();
          for (const procThreadId of procThreadIds) {
            const msgsRes = await discordFetch(`${DISCORD_API}/channels/${procThreadId}/messages?limit=50`, {
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
            if (!msgsRes.ok) continue;
            const msgs = await msgsRes.json();
            const braceletLinkMsg = Array.isArray(msgs) && msgs.find(m => m.content && m.content.includes("Bracelet") && m.content.includes("<#"));
            if (braceletLinkMsg) {
              for (const match of braceletLinkMsg.content.matchAll(/<#(\d+)>/g)) braceletThreadIds.add(match[1]);
            }
          }
          for (const braceletThreadId of braceletThreadIds) {
              await applyTagAndMessage(braceletThreadId);

              // Si affaire clÃ´turÃ©e : demander confirmation avant de fermer le bracelet
              if (tagName === "AFFAIRE CLOTURER") {
                let ping = "Agent en charge du bracelet";
                try {
                  const braceletMsgsRes = await discordFetch(`${DISCORD_API}/channels/${braceletThreadId}/messages?limit=10`, {
                    headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
                  });
                  const braceletMsgs = await braceletMsgsRes.json();
                  // Premier message du thread = le message du bot avec "PosÃ© par : PrÃ©nom Nom (matricule)"
                  const firstMsg = Array.isArray(braceletMsgs) && braceletMsgs[braceletMsgs.length - 1];
                  if (firstMsg && firstMsg.content) {
                    const poseMatch = firstMsg.content.match(/PosÃ© par : .+?\((\d+)\)/);
                    if (poseMatch) {
                      const agent = await getAgentByMatricule(env, poseMatch[1]);
                      ping = agent && agent.discord_id ? `<@${agent.discord_id}>` : `Matricule ${poseMatch[1]}`;
                    }
                  }
                } catch {}
                await discordFetch(`${DISCORD_API}/channels/${braceletThreadId}/messages`, {
                  method: "POST",
                  headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    content: `${ping} â€” Le dossier procureur a Ã©tÃ© clÃ´turÃ©. Avez-vous retirÃ© le bracelet Ã©lectronique ?`,
                    components: [{ type: 1, components: [
                      { type: 2, style: 3, label: "Oui, bracelet retirÃ©", custom_id: "bracelet_close_confirm_yes" },
                      { type: 2, style: 4, label: "Non, pas encore", custom_id: "bracelet_close_confirm_no" }
                    ] }]
                  })
                });
              }
          }
        } catch {}

        await discordFetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "ðŸ·ï¸ Statut mis Ã  jour", color: 0x9b59b6, fields: [
            { name: "ðŸ“Œ Statut", value: tagName, inline: true },
            { name: "ðŸ‘® Par", value: agentDisplay, inline: true }
          ], footer: { text: "SASP Â· Proc/Bracelet" }, timestamp: now.toISOString() }] })
        });
        return json({ type: 4, data: { content: `âœ… Statut mis Ã  jour : **${tagName}**`, flags: 64 } });
      }

      // Confirmation retrait bracelet aprÃ¨s clÃ´ture proc
      if (interaction.type === 3 && interaction.data.custom_id === "bracelet_close_confirm_yes") {
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const messages = await getThreadMessages(interaction.channel_id);
        const sourceMessage = messages.find(m => String(m.content || "").toUpperCase().includes("BRACELET ELECTRONIQUE DE"));
        const parsed = parseBraceletMessage(sourceMessage ? sourceMessage.content : "", { name: interaction.channel?.name || "" });
        const copies = await findBraceletCopiesByName(parsed.suspect);
        const closeMessage = `âœ… Bracelet confirmÃ© retirÃ© par ${agentDisplay}. Dossier bracelet fermÃ©.`;
        const targets = copies.length ? copies : [{ threadId: interaction.channel_id }];
        for (const copy of targets) {
          await discordFetch(`${DISCORD_API}/channels/${copy.threadId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content: closeMessage })
          });
          await closeDiscordThread(copy.threadId);
        }
        return json({ type: 4, data: { content: `âœ… Bracelet confirmÃ© retirÃ©, ${targets.length} dossier(s) bracelet fermÃ©(s).`, flags: 64 } });
      }

      if (interaction.type === 3 && interaction.data.custom_id === "bracelet_close_confirm_no") {
        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: `âš ï¸ ${agentDisplay} a indiquÃ© que le bracelet n'est pas encore retirÃ©. Merci de le retirer rapidement ou de voir avec le procureur avant fermeture du dossier bracelet.` })
        });
        return json({ type: 4, data: { content: "âš ï¸ OK, le dossier bracelet reste ouvert. Retire le bracelet ou vois avec le procureur.", flags: 64 } });
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
        const messages = await getThreadMessages(interaction.channel_id);
        const sourceMessage = messages.find(m => String(m.content || "").toUpperCase().includes("BRACELET ELECTRONIQUE DE"));
        const parsed = parseBraceletMessage(sourceMessage ? sourceMessage.content : "", { name: interaction.channel?.name || "Inconnu" });
        const threadName = parsed.suspect || interaction.message?.thread?.name || interaction.channel?.name || "Inconnu";
        const pointageContent = `âœ… Pointage enregistrÃ© le ${dateStr} Ã  ${heureStr} â€” par ${agentDisplay}`;
        const copies = await findBraceletCopiesByName(threadName);
        const targets = copies.length ? copies : [{ threadId: interaction.channel_id }];
        for (const copy of targets) {
          await discordFetch(`${DISCORD_API}/channels/${copy.threadId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ content: pointageContent })
          });
        }
        await discordFetch(`${DISCORD_API}/channels/1521587559384223836/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [{ title: "ðŸ“ Pointage bracelet enregistrÃ©", color: 0x2ecc71, fields: [
            { name: "ðŸ§‘ Suspect", value: threadName, inline: true },
            { name: "ðŸ• Heure", value: `${dateStr} Ã  ${heureStr}`, inline: true },
            { name: "ðŸ‘® EnregistrÃ© par", value: agentDisplay, inline: false }
          ], footer: { text: "SASP Â· Bracelet" }, timestamp: now.toISOString() }] })
        });
        return json({ type: 4, data: { content: `âœ… Pointage enregistrÃ© sur ${targets.length} dossier(s).`, flags: 64 } });
      }

      // Slash command /sync
      if (interaction.type === 2 && interaction.data.name === "sync") {
        const member = interaction.member;
        if (!hasStaffRole(member)) {
          return json({ type: 4, data: { content: "❌ Accès réservé au staff.", flags: 64 } });
        }
        const token = interaction.token;
        const appId = env.DISCORD_APPLICATION_ID;
        ctx.waitUntil((async () => {
          const SOURCE_GUILD = "1500975724750704661";
          const TARGET_GUILD = "1382167184607940658";
          const PAGE = 20;
          let afterCursor = "0";
          let totalSynced = 0, totalSkipped = 0, totalErrors = 0;
          do {
            const targetPage = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members?limit=${PAGE}&after=${afterCursor}`, {
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            }).then(r => r.json()).catch(() => []);
            if (!Array.isArray(targetPage) || !targetPage.length) break;
            for (const m of targetPage) {
              const uid = m.user?.id;
              if (!uid || m.user?.bot) continue;
              const sourceMember = await discordFetch(`${DISCORD_API}/guilds/${SOURCE_GUILD}/members/${uid}`, {
                headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
              }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
              if (!sourceMember) { totalSkipped++; continue; }
              let res;
              for (let attempt = 0; attempt < 3; attempt++) {
                res = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members/${uid}`, {
                  method: "PATCH",
                  headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ nick: sourceMember.nick || null })
                });
                if (res.status === 429) {
                  const body = await res.json().catch(() => ({}));
                  await new Promise(r => setTimeout(r, (body.retry_after || 1) * 1000));
                } else break;
              }
              if (res.status === 204 || res.status === 200) totalSynced++;
              else if (res.status === 403) totalSkipped++;
              else totalErrors++;
              await new Promise(r => setTimeout(r, 300));
            }
            afterCursor = targetPage.length === PAGE ? targetPage[targetPage.length - 1].user.id : null;
          } while (afterCursor);
          await discordFetch(`${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: `✅ Sync terminé — ${totalSynced} renommés, ${totalSkipped} ignorés${totalErrors ? `, ${totalErrors} erreurs` : ""}.` })
          });
        })());
        return json({ type: 5, data: { flags: 64 } });
      }

      // Slash command /plaintesasp
      if (interaction.type === 2 && interaction.data.name === "plaintesasp") {
        return json({
          type: 9,
          data: {
            custom_id: "plaintesasp_modal",
            title: "Plainte anonyme — SASP",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "psasp_motif", label: "Motif de votre plainte", style: 2, required: true, placeholder: "Abus d’autorité, comportement, procédure, hiérarchie, conflit...", min_length: 2, max_length: 1000 }] },
              { type: 1, components: [{ type: 4, custom_id: "psasp_agents", label: "Agent(s) SASP concerne(s)", style: 1, required: true, placeholder: "Nom, matricule ou grade si vous les connaissez", min_length: 2, max_length: 200 }] },
              { type: 1, components: [{ type: 4, custom_id: "psasp_faits", label: "Faits et contexte", style: 2, required: true, placeholder: "Expliquez la situation dans l’ordre et les personnes présentes", min_length: 10, max_length: 2000 }] },
              { type: 1, components: [{ type: 4, custom_id: "psasp_date_lieu", label: "Date, heure et lieu", style: 1, required: true, placeholder: "Date, heure approximative et lieu", min_length: 2, max_length: 200 }] },
              { type: 1, components: [{ type: 4, custom_id: "psasp_preuves", label: "Preuves ou témoins", style: 2, required: false, placeholder: "Screenshots, clips, rapports, témoins, messages...", max_length: 1000 }] }
            ]
          }
        });
      }

      // Modal submit /plaintesasp
      if (interaction.type === 5 && interaction.data.custom_id === "plaintesasp_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value?.trim() || "";
        const cleanField = (value) => (value || "—").slice(0, 1024);
        const user = interaction.member?.user || interaction.user || {};
        const userId = String(user.id || "").replace(/\D/g, "");
        const discordMention = userId ? `<@${userId}>` : "Utilisateur inconnu";
        const targetChannelId = String(env.PLAINTESASP_CHANNEL_ID || PLAINTESASP_DEFAULT_CHANNEL_ID).replace(/\D/g, "");

        const postRes = await discordFetch(`${DISCORD_API}/channels/${targetChannelId}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              title: "🚨 PLAINTE ANONYME — SASP",
              color: 0xc0392b,
              fields: [
                { name: "Auteur", value: cleanField(discordMention), inline: false },
                { name: "Motif", value: cleanField(getValue("psasp_motif")), inline: false },
                { name: "Agent(s) concerné(s)", value: cleanField(getValue("psasp_agents")), inline: false },
                { name: "Description des faits", value: cleanField(getValue("psasp_faits")), inline: false },
                { name: "Date / lieu", value: cleanField(getValue("psasp_date_lieu")), inline: false },
                { name: "Preuves / témoins", value: cleanField(getValue("psasp_preuves")), inline: false }
              ],
              footer: { text: "Signalement anonyme • SASP" },
              timestamp: new Date().toISOString()
            }],
            allowed_mentions: { users: userId ? [userId] : [], parse: [] }
          })
        });

        if (!postRes.ok) {
          await postRes.text().catch(() => "");
          return json({ type: 4, data: { content: `❌ Erreur envoi plainte SASP (${postRes.status}).`, flags: 64 } });
        }

        return json({ type: 4, data: { content: "✅ Votre plainte SASP a bien été transmise anonymement.", flags: 64 } });
      }

      // Slash command /plainte
      if (interaction.type === 2 && interaction.data.name === "plainte") {
        return json({
          type: 9,
          data: {
            custom_id: "plainte_modal",
            title: "DÃ©pÃ´t de plainte",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "plaignant", label: "Plaignant â€” Nom PrÃ©nom", style: 1, required: true, placeholder: "Ex : James Morrison", min_length: 2, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "misen_cause", label: "Mis en cause (Nom PrÃ©nom ou entreprise)", style: 1, required: true, placeholder: "Ex : John Smith", min_length: 2, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "tel_misen_cause", label: "TÃ©l. mis en cause (facultatif)", style: 1, required: false, placeholder: "Ex : +1 555 123 4567", max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "motif", label: "Motif de la plainte", style: 1, required: true, placeholder: "Ex : Vol Ã  main armÃ©e", min_length: 2, max_length: 200 }] },
              { type: 1, components: [{ type: 4, custom_id: "resume", label: "RÃ©sumÃ© des faits", style: 2, required: true, placeholder: "DÃ©crivez les faits...", min_length: 10, max_length: 2000 }] }
            ]
          }
        });
      }

      // Modal submit plainte (nouvelle)
      if (interaction.type === 5 && interaction.data.custom_id === "plainte_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const plaignant      = getValue("plaignant");
        const misenCause     = getValue("misen_cause");
        const telMisenCause  = getValue("tel_misen_cause");
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

        const misenCauseVal = misenCause;
        const fields = [
          { name: "ðŸ“… Date & Heure",      value: `${dateStr} Ã  ${heureStr}`, inline: true },
          { name: "ðŸ‘® Agent en charge",   value: agentDisplay, inline: true },
          { name: "ðŸ™‹ Plaignant",         value: plaignant, inline: false },
          { name: "ðŸŽ¯ Mis en cause",      value: misenCauseVal, inline: false },
          { name: "ðŸ“ž TÃ©lÃ©phone",          value: telMisenCause || "â€”", inline: true },
          { name: "ðŸ“‹ Motif",             value: motif, inline: false },
          { name: "ðŸ“ RÃ©sumÃ© des faits",  value: resume.slice(0, 1024), inline: false },
          { name: "âš–ï¸ Note",              value: "La Cour est respectueusement saisie de ce dossier et invitÃ©e Ã  statuer sur les suites judiciaires Ã  y apporter. Le SASP demeure Ã  disposition pour toute information complÃ©mentaire jugÃ©e nÃ©cessaire Ã  l'instruction de cette affaire.", inline: false }
        ];

        const postRes = await discordFetch(`${DISCORD_API}/channels/${interaction.channel_id}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "<@&1512185605805703187>",
            embeds: [{ title: `ðŸ“‹ Plainte #${plainteId} â€” SASP`, color: 0xc0392b, fields, footer: { text: "SASP â€¢ Service des plaintes" }, timestamp: now.toISOString() }],
            components: [{ type: 1, components: [{ type: 2, style: 2, label: "âœï¸ Modifier", custom_id: `edit_plainte|${userId}` }] }]
          })
        });
        if (!postRes.ok) {
          const err = await postRes.text();
          return json({ type: 4, data: { content: `âŒ Erreur Discord (${postRes.status}): ${err}`, flags: 64 } });
        }

        // Supprime l'ancien sticky puis le renvoie
        try {
          const msgsRes = await discordFetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages?limit=20`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          });
          const msgs = await msgsRes.json();
          const sticky = Array.isArray(msgs) && msgs.find(m => m.embeds?.[0]?.title === "ðŸ“‹ DÃ©poser une plainte");
          if (sticky) {
            await discordFetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages/${sticky.id}`, {
              method: "DELETE",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            });
          }
          await discordFetch(`${DISCORD_API}/channels/${STICKY_PLAINTE_CHANNEL}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify(STICKY_PLAINTE_EMBED)
          });
        } catch {}

        return json({ type: 4, data: { content: "âœ… Plainte enregistrÃ©e !\n\nMaintenant, faites un **copier-coller** du message de la plainte et envoyez-le ici : https://discord.com/channels/1512185605805703179/1517219854724235477", flags: 64 } });
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
        const telMisenCause  = getValue("tel_misen_cause");
        const motif          = getValue("motif");
        const resume         = getValue("resume");

        // RÃ©cupÃ¨re dossier # et agent en charge depuis l'embed original
        const origRes = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
        const origMsg = await origRes.json();
        const origEmbed = origMsg.embeds?.[0] || {};
        const origTitle = origEmbed.title || `ðŸ“‹ Plainte â€” SASP`;
        const origGetField = (kw) => (origEmbed.fields || []).find(f => f.name.includes(kw))?.value || "";
        const agentStr = origGetField("Agent");
        const dateStr  = origGetField("Date");

        const misenCauseVal = misenCause;
        const newFields = [
          { name: "ðŸ“… Date & Heure",      value: dateStr, inline: true },
          { name: "ðŸ‘® Agent en charge",   value: agentStr, inline: true },
          { name: "ðŸ™‹ Plaignant",         value: plaignant, inline: false },
          { name: "ðŸŽ¯ Mis en cause",      value: misenCauseVal, inline: false },
          { name: "ðŸ“ž TÃ©lÃ©phone",          value: telMisenCause || "â€”", inline: true },
          { name: "ðŸ“‹ Motif",             value: motif, inline: false },
          { name: "ðŸ“ RÃ©sumÃ© des faits",  value: resume.slice(0, 1024), inline: false },
          { name: "âš–ï¸ Note",              value: "La Cour est respectueusement saisie de ce dossier et invitÃ©e Ã  statuer sur les suites judiciaires Ã  y apporter. Le SASP demeure Ã  disposition pour toute information complÃ©mentaire jugÃ©e nÃ©cessaire Ã  l'instruction de cette affaire.", inline: false }
        ];

        await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
          method: "PATCH",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "<@&1512185605805703187>",
            embeds: [{ title: origTitle, color: 0xe67e22, fields: newFields, footer: { text: "SASP â€¢ Service des plaintes (modifiÃ©e)" }, timestamp: new Date().toISOString() }],
            components: [{ type: 1, components: [{ type: 2, style: 2, label: "âœï¸ Modifier", custom_id: `edit_plainte|${creatorId}` }] }]
          })
        });
        return json({ type: 4, data: { content: "âœ… Plainte modifiÃ©e.", flags: 64 } });
      }

      // Composant (bouton ou select)
      if (interaction.type === 3) {
        const customId = interaction.data.custom_id;
        const discordUserId = interaction.member?.user?.id || interaction.user?.id;
        const member = interaction.member;

        if (customId.startsWith("pointeuse_confirm_yes|") || customId.startsWith("pointeuse_confirm_no|")) {
          ctx.waitUntil(handlePointeuseConfirmationButton(env, interaction, customId));
          return json({ type: 6 });
        }

        if (customId.startsWith("ftf_convocation_schedule|")) {
          const dossierId = customId.split("|")[1];
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          return json({
            type: 9,
            data: {
              custom_id: `ftf_convocation_modal|${dossierId}`,
              title: "Planifier convocation FTF",
              components: [
                { type: 1, components: [{ type: 4, custom_id: "ftf_convocation_date", label: "Date de convocation", style: 1, required: true, value: tomorrow, placeholder: "AAAA-MM-JJ", max_length: 20 }] },
                { type: 1, components: [{ type: 4, custom_id: "ftf_convocation_hour", label: "Heure de convocation", style: 1, required: true, placeholder: "Ex : 18H30", max_length: 20 }] }
              ]
            }
          });
        }

        if (customId.startsWith("ftf_convocation_done|")) {
          const dossierId = customId.split("|")[1];
          const dossier = await getFtfDossier(env, dossierId);
          if (!dossier) return json({ type: 4, data: { content: "Dossier FTF introuvable.", flags: 64 } });
          const updated = {
            ...dossier,
            convocation_validee: true,
            convocation_traitee_par: discordUserId,
            updated_at: new Date().toISOString()
          };
          await upsertFtfDossier(env, updated);
          const components = (interaction.message.components || []).map(row => ({
            ...row,
            components: (row.components || []).map(c => ({ ...c, disabled: true }))
          }));
          return json({
            type: 7,
            data: {
              content: interaction.message.content || "",
              embeds: interaction.message.embeds || [],
              components
            }
          });
        }

        // â”€â”€ Bouton modifier plainte â”€â”€
        if (customId.startsWith("edit_plainte|")) {
          const creatorId = customId.split("|")[1];
          const clickerId = interaction.member?.user?.id || interaction.user?.id;
          const isAdmin = ADMIN_ROLE_IDS.some(r => (interaction.member?.roles || []).includes(r));
          if (clickerId !== creatorId && !isAdmin) {
            return json({ type: 4, data: { content: "âŒ Seul le crÃ©ateur de la plainte ou un admin peut la modifier.", flags: 64 } });
          }
          const embed = interaction.message.embeds?.[0] || {};
          const getField = (kw) => (embed.fields || []).find(f => f.name.includes(kw))?.value || "";
          const misenVal = getField("Mis en cause");
          const telRaw   = getField("TÃ©lÃ©phone");
          const telVal   = telRaw === "â€”" ? "" : telRaw;
          const channelId = interaction.channel_id;
          const messageId = interaction.message.id;
          return json({
            type: 9,
            data: {
              custom_id: `edit_plainte_modal|${channelId}|${messageId}|${creatorId}`,
              title: "Modifier la plainte",
              components: [
                { type: 1, components: [{ type: 4, custom_id: "plaignant", label: "Plaignant â€” Nom PrÃ©nom", style: 1, required: true, value: getField("Plaignant"), min_length: 2, max_length: 80 }] },
                { type: 1, components: [{ type: 4, custom_id: "misen_cause", label: "Mis en cause", style: 1, required: true, value: misenVal, min_length: 2, max_length: 80 }] },
                { type: 1, components: [{ type: 4, custom_id: "tel_misen_cause", label: "TÃ©l. mis en cause (facultatif)", style: 1, required: false, value: telVal, max_length: 30 }] },
                { type: 1, components: [{ type: 4, custom_id: "motif", label: "Motif de la plainte", style: 1, required: true, value: getField("Motif"), min_length: 2, max_length: 200 }] },
                { type: 1, components: [{ type: 4, custom_id: "resume", label: "RÃ©sumÃ© des faits", style: 2, required: true, value: getField("RÃ©sumÃ©"), min_length: 10, max_length: 2000 }] }
              ]
            }
          });
        }

        // â”€â”€ Select menu : retirer un agent â”€â”€
        if (customId.startsWith("remove_agent|")) {
          if (!hasStaffRole(member)) {
            return json({ type: 4, data: { content: "âŒ Permissions insuffisantes.", flags: 64 } });
          }
          const parts = customId.split("|");
          const channelId = parts[1];
          const messageId = parts[2];
          const agentId = interaction.data.values[0];
          const siteKey = siteKeyFromGuildId(interaction.guild_id);

          const agent = await getAgentById(env, agentId, siteKey).catch(() => null);
          if (agent) {
            await closeActivePointagesForAgentIdentity(env, agent, siteKey);
          } else {
            await closeActivePointagesForAgent(env, agentId, siteKey);
          }

          const allActive = await getAllActivePointages(env, siteKey);
          await editMessage(env, channelId, messageId, buildPointeuseMessage(allActive));

          return json({ type: 7, data: { content: "âœ… Agent retirÃ© du service.", components: [], flags: 64 } });
        }

        // â”€â”€ Bouton admin : afficher le select â”€â”€
        if (customId === "admin_remove") {
          if (!hasStaffRole(member)) {
            return json({ type: 4, data: { content: "âŒ Tu n'as pas les permissions pour cette action.", flags: 64 } });
          }
          const siteKey = siteKeyFromGuildId(interaction.guild_id);
          const active = uniqueActivePointages(await getAllActivePointages(env, siteKey));
          if (!active.length) {
            const channelId = interaction.channel_id;
            const messageId = interaction.message?.id;
            if (channelId && messageId) {
              await editMessage(env, channelId, messageId, buildPointeuseMessage([])).catch(() => null);
            }
            return json({ type: 4, data: { content: "Aucun agent en service actuellement.", flags: 64 } });
          }
          const options = active.map(p => {
            const a = p.agents || {};
            return {
              label: `${(a.prenom + " " + a.nom).trim()} (${a.matricule || "â€”"})`,
              value: p.agent_id
            };
          });
          const channelId = interaction.channel_id;
          const messageId = interaction.message.id;
          return json({
            type: 4,
            data: {
              flags: 64,
              content: "SÃ©lectionne l'agent Ã  retirer du service :",
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

        // â”€â”€ Prise / fin de service â”€â”€
        if (customId !== "prise_service" && customId !== "fin_service") {
          return json({ type: 4, data: { content: "âŒ Action inconnue.", flags: 64 } });
        }

        ctx.waitUntil(handlePointeuseServiceButton(env, interaction, customId));
        return json({ type: 5, data: { flags: 64 } });
      }

      return json({ type: 4, data: { content: "Type d'interaction non supporté.", flags: 64 } });
      } catch(e) {
        return json({ type: 4, data: { content: `❌ Erreur interne : ${e.message || e}`, flags: 64 } });
      }
    }

    // ── Forcer fin de service pour un agent précis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/clockout-agent" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const { agent_id, site } = await request.json();
      if (!agent_id) return json({ error: "Missing agent_id" }, 400);
      const siteKey = site === "nord" ? "nord" : "sud";
      const closed = await closeActivePointagesForAgent(env, agent_id, siteKey);
      return json({ ok: closed.count > 0, count: closed.count, message: closed.count ? "Agent retiré du service" : "Agent non en service" });
    }

    if (url.pathname === "/refresh-pointeuse" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const siteKey = body.site === "nord" ? "nord" : "sud";
      const chId = body.channel_id || env.POINTEUSE_CHANNEL_ID;
      if (body.all_messages) {
        return json(await refreshPointeuseChannelBoards(env, chId, siteKey, body.limit || 50));
      }
      const msgId = body.message_id || env.POINTEUSE_MESSAGE_ID;
      if (!chId || !msgId) return json({ ok: false, error: "Missing pointeuse message config" }, 400);
      const active = await getAllActivePointages(env, siteKey);
      await editMessage(env, chId, msgId, buildPointeuseMessage(active));
      return json({ ok: true, count: uniqueActivePointages(active).length });
    }

    if (url.pathname === "/admin/refresh-pointeuse-channel" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const siteKey = body.site === "nord" ? "nord" : "sud";
      const chId = body.channel_id || env.POINTEUSE_CHANNEL_ID;
      return json(await refreshPointeuseChannelBoards(env, chId, siteKey, body.limit || 50));
    }

    if (url.pathname === "/admin/send-channel-message" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const channelId = String(body.channel_id || "").replace(/\D/g, "");
      const content = String(body.content || "").trim();
      if (!channelId) return json({ ok: false, error: "Missing channel_id" }, 400);
      if (!content) return json({ ok: false, error: "Missing content" }, 400);
      if (content.length > 2000) return json({ ok: false, error: "Message too long" }, 400);
      const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: ["users", "roles"] }
        })
      });
      const data = await res.json().catch(async () => ({ error: await res.text().catch(() => "") }));
      return json({ ok: res.ok, status: res.status, channel_id: channelId, message_id: data.id || null, response: data }, res.ok ? 200 : 500);
    }

    if (url.pathname === "/admin/edit-channel-message" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const body = await request.json().catch(() => ({}));
      const channelId = String(body.channel_id || "").replace(/\D/g, "");
      const messageId = String(body.message_id || "").replace(/\D/g, "");
      const content = String(body.content || "").trim();
      if (!channelId) return json({ ok: false, error: "Missing channel_id" }, 400);
      if (!messageId) return json({ ok: false, error: "Missing message_id" }, 400);
      if (!content) return json({ ok: false, error: "Missing content" }, 400);
      if (content.length > 2000) return json({ ok: false, error: "Message too long" }, 400);
      const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: ["users", "roles"] }
        })
      });
      const data = await res.json().catch(async () => ({ error: await res.text().catch(() => "") }));
      return json({ ok: res.ok, status: res.status, channel_id: channelId, message_id: messageId, response: data }, res.ok ? 200 : 500);
    }

    // â”€â”€ Reset manuel tous les agents (admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/clockout-all" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const count = await autoClockoutAll(env);
      return json({ ok: true, count });
    }

    if (url.pathname === "/admin/post-completude" && request.method === "GET") {
      const CHANNEL = "1518636313325076672";
      const FIELDS = [
        { key: "iban",             label: "IBAN" },
        { key: "telephone",        label: "Téléphone" },
        { key: "date_naissance",   label: "Date naissance" },
        { key: "date_recrutement", label: "Date recrutement" },
        { key: "discord_id",       label: "Discord ID" }
      ];
      try {
        const agents = await sbForSite(env, "GET", `/agents?select=matricule,nom,prenom,grade,iban,telephone,date_naissance,date_recrutement,discord_id&statut=neq.Arch%C3%A9&order=matricule`, null, "sud");
        const incomplete = (agents || []).filter(a => FIELDS.some(f => !a[f.key]));

        if (!incomplete.length) {
          await discordFetch(`${DISCORD_API}/channels/${CHANNEL}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [{ title: "✅ Complétude des fiches", description: "Toutes les fiches agents sont complètes.", color: 0x2ecc71 }] })
          });
          return json({ ok: true, incomplete: 0 });
        }

        const lines = incomplete.map(a => {
          const missing = FIELDS.filter(f => !a[f.key]).map(f => f.label).join(", ");
          return `> **(${a.matricule})** ${a.prenom} ${a.nom} — ${missing}`;
        });

        const chunks = [];
        let cur = "";
        for (const l of lines) {
          if ((cur + "\n" + l).length > 1000) { chunks.push(cur); cur = l; }
          else cur = cur ? cur + "\n" + l : l;
        }
        if (cur) chunks.push(cur);

        const now = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const fields = chunks.map((c, i) => ({ name: i === 0 ? `${incomplete.length} fiche(s) incomplète(s)` : "​", value: c, inline: false }));
        const embed = { title: "📋 Complétude des fiches agents", color: 0xe74c3c, fields, footer: { text: `Mis à jour le ${now}` } };

        await discordFetch(`${DISCORD_API}/channels/${CHANNEL}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] })
        });
        return json({ ok: true, incomplete: incomplete.length });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/post-referents" && request.method === "GET") {
      const CHANNEL = "1518640738559197284";
      try {
        const agents = await sbForSite(env, "GET",
          `/agents?select=id,nom,prenom,matricule,grade,statut,referent_id,referent:referent_id(id,nom,prenom,matricule,grade)&statut=neq.Arch%C3%A9&order=matricule`,
          null, "sud"
        );
        const referes = (agents || []).filter(a => a.grade === "Rookie" || a.grade === "Trooper I");

        // Grouper par référent
        const byRef = {};
        const sans = [];
        referes.forEach(a => {
          if (a.referent_id && a.referent) {
            const key = a.referent_id;
            if (!byRef[key]) byRef[key] = { ref: a.referent, list: [] };
            byRef[key].list.push(a);
          } else {
            sans.push(a);
          }
        });

        const fields = [];
        Object.values(byRef).forEach(({ ref, list }) => {
          fields.push({
            name: `${ref.grade} ${ref.prenom} ${ref.nom} (${ref.matricule})`,
            value: list.map(x => `> ${x.grade === "Rookie" ? "🎓" : "🔵"} **(${x.matricule})** ${x.prenom} ${x.nom}`).join("\n"),
            inline: false
          });
        });
        if (sans.length) {
          fields.push({
            name: "❌ Sans référent",
            value: sans.map(x => `> ${x.grade === "Rookie" ? "🎓" : "🔵"} **(${x.matricule})** ${x.prenom} ${x.nom}`).join("\n"),
            inline: false
          });
        }

        const now = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        const embed = {
          title: "📋 Tableau des Référents SASP",
          color: 0xC9A84C,
          fields,
          footer: { text: `Mis à jour le ${now}` }
        };

        const res = await discordFetch(`${DISCORD_API}/channels/${CHANNEL}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ embeds: [embed] })
        });
        const data = await res.json();
        return json({ ok: res.ok, message_id: data.id });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/sync-grades-from-discord" && request.method === "GET") {
      const guildId = SUD_SITE_GUILD_ID;
      try {
        // 1. Tous les agents avec discord_id
        const agents = await sbForSite(env, "GET", `/agents?select=id,grade,discord_id&discord_id=not.is.null&statut=neq.Arch%C3%A9`, null, "sud");
        const agentByDiscord = {};
        for (const a of (agents || [])) agentByDiscord[a.discord_id] = a;

        // 2. Tous les membres Discord (paginé 1000)
        let after = "0", updated = 0, unchanged = 0, errors = [];
        do {
          const members = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members?limit=1000&after=${after}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          }).then(r => r.json());

          for (const m of members) {
            const uid = m.user?.id;
            if (!uid || m.user?.bot) continue;
            const agent = agentByDiscord[uid];
            if (!agent) continue;
            const discordGrade = gradeFromRolesForGuild(m.roles || [], guildId);
            if (!discordGrade || discordGrade === agent.grade) { unchanged++; continue; }
            const res = await sbForSite(env, "PATCH", `/agents?id=eq.${agent.id}`, { grade: discordGrade, updated_at: new Date().toISOString() }, "sud");
            updated++;
          }

          after = members.length === 1000 ? members[members.length - 1].user.id : null;
        } while (after);

        return json({ ok: true, updated, unchanged, errors });
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/react-channel-check" && request.method === "GET") {
      try {
        const channelId = url.searchParams.get("channel_id") || AUTO_REACTION_CHANNEL_ID;
        const limit = Number(url.searchParams.get("limit") || 20);
        return json(await reactToChannelMessages(env, channelId, limit));
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    if (url.pathname === "/admin/send-ceremonie-reminder" && request.method === "GET") {
      try {
        return json(await sendCeremonieReminder(env, {
          force: url.searchParams.get("force") === "1",
          channelId: url.searchParams.get("channel_id")
        }));
      } catch(e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  },

  // â”€â”€ Cron â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async scheduled(event, env, ctx) {
    if (event.cron === '0 18 * * SUN') {
      ctx.waitUntil(autoClockoutAll(env));
    } else {
      ctx.waitUntil(processPointeuseConfirmations(env, "sud"));
      if (env.POINTEUSE_CHANNEL_ID && env.POINTEUSE_MESSAGE_ID) {
        ctx.waitUntil(refreshPointeuseMessage(env, env.POINTEUSE_CHANNEL_ID, env.POINTEUSE_MESSAGE_ID, "sud").catch(() => null));
      }
      ctx.waitUntil(reactToChannelMessages(env).catch(() => null));
      ctx.waitUntil((async () => {
        const SOURCE_GUILD  = "1500975724750704661";
        const TARGET_GUILD  = "1382167184607940658";
        const ALLOWED_ROLES = ["1501250580058870104", "1512410095173238814"];
        try {
          // Sync pseudos (itère TARGET, copie nick depuis SOURCE)
          let afterCursor = "0";
          do {
            const targetPage = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members?limit=20&after=${afterCursor}`, {
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            }).then(r => r.json()).catch(() => []);
            for (const m of targetPage) {
              const uid = m.user?.id;
              if (!uid || m.user?.bot) continue;
              const src = await discordFetch(`${DISCORD_API}/guilds/${SOURCE_GUILD}/members/${uid}`, {
                headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
              }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
              if (!src) continue;
              await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members/${uid}`, {
                method: "PATCH",
                headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify({ nick: src.nick || null })
              });
              await new Promise(r => setTimeout(r, 300));
            }
            afterCursor = targetPage.length === 20 ? targetPage[targetPage.length - 1].user.id : null;
          } while (afterCursor);
          // Kick membres sans rôle SASP requis
          const targetMembers = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members?limit=1000`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          }).then(r => r.json());
          for (const m of targetMembers) {
            if (m.user?.bot) continue;
            const uid = m.user?.id;
            if (!uid) continue;
            const saspRes = await discordFetch(`${DISCORD_API}/guilds/${SOURCE_GUILD}/members/${uid}`, {
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            }).catch(() => null);
            if (!saspRes || (saspRes.status !== 200 && saspRes.status !== 404)) continue;
            const saspMember = saspRes.status === 200 ? await saspRes.json() : null;
            if (!saspMember || !ALLOWED_ROLES.some(r => (saspMember.roles || []).includes(r))) {
              await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members/${uid}`, {
                method: "DELETE",
                headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
              });
            }
          }
        } catch(e) {}
      })());
    }
  }
};
