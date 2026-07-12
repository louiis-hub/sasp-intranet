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
  '1519507318188933140', // rÃ´le gestionnaire
  '1500975725153620033', // Command Staff
  '1504451288065118248', // Ã‰tat Major
  '1504452141518032956', // Supervisor Team
  '1518631987462668358'  // Police Academy
];

const ADMIN_ROLE_IDS = [
  '1500975725153620033', // Command Staff
  '1504451288065118248', // Ã‰tat Major
  '1504452141518032956'  // Supervisor Team
];
const FTF_ROLE_ID = "1524117754725007422";
const FTF_NOTIFICATION_CHANNEL_ID = "1524118534077153330";
const FTF_CONVOCATION_CHANNEL_ID = "1524118534077153330";

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
  const data = await sbForSite(env, "GET", `/agents?discord_id=eq.${discordId}&select=id,nom,prenom,matricule,discord_id,grade&limit=1`, null, siteKey);
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
    if (agent) return { nom: agent.nom || "", prenom: agent.prenom || "", matricule: agent.matricule || "", source: "fiche" };
  } catch {}
  const member = interaction.member || {};
  const user = member.user || interaction.user || {};
  const displayName = member.nick || user.global_name || user.username || "";
  const parsed = parseAgentIdentityFromDiscordName(displayName);
  if (parsed) return { ...parsed, source: "discord" };
  return { nom: "", prenom: displayName || `<@${userId}>`, matricule: "", source: "discord" };
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
  const data = await sbForSite(env, "GET", `/agents?matricule=eq.${matricule}&select=id,nom,prenom,matricule,discord_id&limit=1`, null, siteKey);
  return data && data.length > 0 ? data[0] : null;
}

async function getActivePointage(env, agentId, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/pointages?agent_id=eq.${agentId}&clock_out=is.null&limit=1`, null, siteKey);
  return data && data.length > 0 ? data[0] : null;
}

async function getAllActivePointages(env, siteKey = "sud") {
  const data = await sbForSite(env, "GET", `/pointages?clock_out=is.null&select=id,agent_id,clock_in,agents(nom,prenom,matricule)&order=clock_in.asc`, null, siteKey);
  return data || [];
}

// â”€â”€ Message pointeuse â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildPointeuseMessage(active) {
  const count = active.length;
  const list = active.map(p => {
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

// â”€â”€ Auto clock-out agents en service depuis +6h â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    return `\u2022 **${(a.prenom + ' ' + a.nom).trim()}** (${a.matricule || '\u2014'}) a oubli\u00e9 de terminer son service et a bien \u00e9t\u00e9 d\u00e9connect\u00e9 automatiquement.`;
  }).join('\n');
  await discordFetch(`${DISCORD_API}/channels/1519525957390827711/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `<@&1500975725153620033>`,
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
  return expired.length;
}

// â”€â”€ Auto clock-out tous les agents actifs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function autoClockoutAll(env) {
  const active = await getAllActivePointages(env);
  if (!active.length) return 0;
  const now = new Date().toISOString();
  for (const p of active) {
    await sb(env, "PATCH", `/pointages?id=eq.${p.id}`, { clock_out: now });
  }
  const names = active.map(p => {
    const a = p.agents || {};
    return `\u2022 ${(a.prenom + ' ' + a.nom).trim()} (${a.matricule || '\u2014'})`;
  }).join('\n');
  await discordFetch(`${DISCORD_API}/channels/1519525957390827711/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: '\ud83d\udd57 Fin de service automatique \u2014 Dimanche 20h',
        description: `**${active.length} agent${active.length > 1 ? 's' : ''} d\u00e9connect\u00e9${active.length > 1 ? 's' : ''} automatiquement :**\n${names}`,
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
  return active.length;
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default {
  async fetch(request, env) {
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
    const STICKY_SUBVENTION_EMBED = { embeds: [{ title: "ðŸ’¸ RÃ¨gles subvention", color: 0xc9a84c, description: "Pour faire une demande de subvention, utilisez la commande `/subvention` dans ce salon.\n\n**RÃ¨gles actuelles :**\nâ€¢ La subvention est fixÃ©e Ã  **10 000 $ par voiture** pour le moment.\nâ€¢ Il est interdit de faire des **performances** avec cette subvention.\nâ€¢ Il est interdit d'acheter une **nouvelle voiture** avec cette subvention.", footer: { text: "SASP â€¢ Subvention" } }] };
    async function refreshSubventionSticky() {
      const msgsRes = await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages?limit=20`, {
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
      });
      const msgs = await msgsRes.json();
      const sticky = Array.isArray(msgs) && msgs.find(m => m.embeds?.[0]?.title === "ðŸ’¸ RÃ¨gles subvention");
      if (sticky) {
        await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages/${sticky.id}`, {
          method: "DELETE",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        });
      }
      return discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages`, {
        method: "POST",
        headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(STICKY_SUBVENTION_EMBED)
      });
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
      const res = await refreshSubventionSticky();
      const data = await res.json();
      return json({ ok: res.ok, data });
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

    if (url.pathname === "/admin/kick-non-sasp" && request.method === "GET") {
      const SASP_GUILD   = "1500975724750704661";
      const TARGET_GUILD = "1382167184607940658";
      const REQUIRED_ROLE = "1501250580058870104";
      try {
        const targetMembers = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members?limit=1000`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        }).then(r => r.json());
        let kicked = 0, kept = 0, errors = [];
        for (const m of targetMembers) {
          if (m.user?.bot) continue;
          const uid = m.user?.id;
          if (!uid) continue;
          const saspMember = await discordFetch(`${DISCORD_API}/guilds/${SASP_GUILD}/members/${uid}`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
          const hasRole = saspMember && (saspMember.roles || []).includes(REQUIRED_ROLE);
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
      const TARGET_GUILD = url.searchParams.get("target") || "1382167184607940658";
      try {
        const members = await discordFetch(`${DISCORD_API}/guilds/${SOURCE_GUILD}/members?limit=1000`, {
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
        }).then(r => r.json());
        let synced = 0, skipped = 0, errors = [];
        for (const m of members) {
          const nick = m.nick;
          const uid = m.user?.id;
          if (!uid) continue;
          const res = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members/${uid}`, {
            method: "PATCH",
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ nick: nick || null })
          });
          if (res.status === 204 || res.status === 200) synced++;
          else if (res.status === 404) skipped++;
          else errors.push(`${uid}: ${res.status}`);
        }
        return json({ ok: true, synced, skipped, errors });
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
        const res = await discordFetch(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "subvention", description: "DÃ©poser une demande de subvention agent" })
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

      const interaction = JSON.parse(body);

      // Ping
      if (interaction.type === 1) return json({ type: 1 });

      // Slash command /subvention
      if (interaction.type === 2 && interaction.data.name === "subvention") {
        if (interaction.channel_id !== SUBVENTION_CHANNEL) {
          return json({ type: 4, data: { content: `âŒ Utilise cette commande dans <#${SUBVENTION_CHANNEL}>.`, flags: 64 } });
        }
        return json({
          type: 9,
          data: {
            custom_id: "subvention_modal",
            title: "Demande de subvention",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "sub_raison", label: "Raison de la subvention", style: 2, required: true, placeholder: "Expliquez la raison de la demandeâ€¦", min_length: 5, max_length: 1000 }] },
              { type: 1, components: [{ type: 4, custom_id: "sub_somme", label: "Somme", style: 1, required: true, placeholder: "Ex : 25 000 $", min_length: 1, max_length: 30 }] }
            ]
          }
        });
      }

      // Modal submit /subvention
      if (interaction.type === 5 && interaction.data.custom_id === "subvention_modal") {
        const getValue = (id) => interaction.data.components?.flatMap(r => r.components)?.find(c => c.custom_id === id)?.value || "";
        const raison    = getValue("sub_raison");
        const somme     = getValue("sub_somme");
        const userId = interaction.member?.user?.id || interaction.user?.id;
        const identity = await getAgentIdentityForInteraction(env, interaction);
        const agentName = `${identity.prenom || ""} ${identity.nom || ""}`.trim() || `<@${userId}>`;
        const matricule = identity.matricule || "â€”";
        const sourceLabel = identity.source === "fiche" ? "fiche intranet" : "pseudo Discord";
        const now = new Date();
        const res = await discordFetch(`${DISCORD_API}/channels/${SUBVENTION_CHANNEL}/messages`, {
          method: "POST",
          headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            content: "<@&1500975725153620033>",
            embeds: [{
              title: "ðŸ’¸ Demande de subvention",
              color: 0xc9a84c,
              fields: [
                { name: "ðŸ‘¤ Agent", value: agentName, inline: true },
                { name: "ðŸ†” Matricule", value: matricule, inline: true },
                { name: "ðŸ’° Somme", value: somme, inline: true },
                { name: "ðŸ“‹ Raison", value: raison.slice(0, 1024), inline: false },
                { name: "ðŸ“¨ DemandÃ© par", value: `<@${userId}>`, inline: true },
                { name: "ðŸ”Ž Source identitÃ©", value: sourceLabel, inline: true }
              ],
              footer: { text: "SASP â€¢ Subvention" },
              timestamp: now.toISOString()
            }]
          })
        });
        if (!res.ok) {
          const err = await res.text();
          return json({ type: 4, data: { content: `âŒ Erreur crÃ©ation subvention (${res.status}): ${err}`, flags: 64 } });
        }
        try { await refreshSubventionSticky(); } catch {}
        return json({ type: 4, data: { content: `âœ… Demande de subvention envoyÃ©e pour **${agentName}**.`, flags: 64 } });
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
              { type: 1, components: [{ type: 4, custom_id: "bracelet_accord_proc", label: "Demande procureur", style: 1, required: true, placeholder: "Oui ou Non", max_length: 3 }] }
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
        const accordProc = getValue("bracelet_accord_proc") || "Non";

        const userId = interaction.member?.user?.id || interaction.user?.id;
        let agentDisplay = `<@${userId}>`;
        try {
          const agent = await getAgentByDiscordId(env, userId);
          if (agent) agentDisplay = `${agent.prenom} ${agent.nom} (${agent.matricule})`;
        } catch {}

        const origin = getSaspOrigin(interaction);
        const content = `BRACELET ELECTRONIQUE DE ${suspect.toUpperCase()}\n\nOrigine : ${origin.label}\nPos\u00e9 le : ${date}\nNum\u00e9ro de t\u00e9l\u00e9phone : ${tel}\nRaison : ${raison}\nDemande procureur : ${accordProc}\nPos\u00e9 par : ${agentDisplay}\n\nPensez \u00e0 bien noter quand les individus viennent pointer\n\n\u2139\ufe0f Les bracelets peuvent \u00eatre activ\u00e9s pour voir la position une fois toutes les 24h via un message "BIP" sur le t\u00e9l\u00e9phone de l'individu.`;

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
        const getProcTextField = (label) => {
          const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const match = content.match(new RegExp(`\\*\\*${escaped}\\s*:?\\*\\*\\s*([\\s\\S]*?)(?=\\n\\n\\*\\*|$)`, "i"));
          return match ? match[1].trim() : "";
        };
        const suspectName = getProcTextField("Suspect");
        const telSuspect  = getProcTextField("Num\u00e9ros de tel. du suspect");
        const chefs       = getProcTextField("Chef(s) d'accusation");
        const originLabel = getProcTextField("Origine") || getSaspOrigin(interaction).label;
        const originToken = encodeURIComponent(originLabel);
        const now = new Date();
        const dateDefault = now.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
        return json({
          type: 9,
          data: {
            custom_id: `bracelet_modal|${originToken}`,
            title: "Bracelet Ã‰lectronique",
            components: [
              { type: 1, components: [{ type: 4, custom_id: "bracelet_suspect", label: "Nom PrÃ©nom du suspect", style: 1, required: true, value: suspectName, max_length: 80 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_date", label: "PosÃ© le", style: 1, required: true, value: dateDefault, max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_tel", label: "NumÃ©ro de tÃ©lÃ©phone", style: 1, required: true, value: telSuspect, max_length: 30 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_raison", label: "Chef(s) d'inculpation", style: 2, required: true, value: chefs, max_length: 500 }] },
              { type: 1, components: [{ type: 4, custom_id: "bracelet_accord_proc", label: "Demande procureur", style: 1, required: true, placeholder: "Oui ou Non", max_length: 3 }] }
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
        const originLabel = originToken ? decodeURIComponent(originToken) : getSaspOrigin(interaction).label;

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

          const active = await getActivePointage(env, agentId);
          if (active) {
            await sb(env, "PATCH", `/pointages?id=eq.${active.id}`, { clock_out: new Date().toISOString() });
          }

          const allActive = await getAllActivePointages(env);
          await editMessage(env, channelId, messageId, buildPointeuseMessage(allActive));

          return json({ type: 7, data: { content: "âœ… Agent retirÃ© du service.", components: [], flags: 64 } });
        }

        // â”€â”€ Bouton admin : afficher le select â”€â”€
        if (customId === "admin_remove") {
          if (!hasStaffRole(member)) {
            return json({ type: 4, data: { content: "âŒ Tu n'as pas les permissions pour cette action.", flags: 64 } });
          }
          const active = await getAllActivePointages(env);
          if (!active.length) {
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

        let agent;
        const pointeuseSiteKey = siteKeyFromGuildId(interaction.guild_id);
        try {
          agent = await getAgentForPointeuseInteraction(env, interaction, pointeuseSiteKey);
        } catch (e) {
          return json({ type: 4, data: { content: `âŒ Erreur : ${e.message}`, flags: 64 } });
        }

        if (!agent) {
          return json({ type: 4, data: { content: "âŒ Ton Discord ID n'est liÃ© Ã  aucun agent. Configure-le dans ton profil sur l'intranet.", flags: 64 } });
        }

        if (customId === "prise_service") {
          const existing = await getActivePointage(env, agent.id, pointeuseSiteKey);
          if (existing) {
            return json({ type: 4, data: { content: `âš ï¸ Tu es dÃ©jÃ  en service, ${agent.prenom} !`, flags: 64 } });
          }
          await sbForSite(env, "POST", "/pointages", { agent_id: agent.id, clock_in: new Date().toISOString() }, pointeuseSiteKey);
        } else {
          const active = await getActivePointage(env, agent.id, pointeuseSiteKey);
          if (!active) {
            return json({ type: 4, data: { content: `âš ï¸ Tu n'es pas en service, ${agent.prenom} !`, flags: 64 } });
          }
          await sbForSite(env, "PATCH", `/pointages?id=eq.${active.id}`, { clock_out: new Date().toISOString() }, pointeuseSiteKey);
        }

        const allActive = await getAllActivePointages(env, pointeuseSiteKey);
        return json({ type: 7, data: buildPointeuseMessage(allActive) });
      }

      return json({ type: 4, data: { content: "Type d'interaction non supportÃ©.", flags: 64 } });
    }

    // â”€â”€ Forcer fin de service pour un agent prÃ©cis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Reset manuel tous les agents (admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (url.pathname === "/clockout-all" && request.method === "POST") {
      const token = request.headers.get("x-log-token");
      if (token !== (env.LOG_TOKEN || "SASPlogs2026!")) return json({ error: "Unauthorized" }, 401);
      const count = await autoClockoutAll(env);
      return json({ ok: true, count });
    }

    return json({ error: "Not found" }, 404);
  },

  // â”€â”€ Cron â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async scheduled(event, env, ctx) {
    if (event.cron === '0 18 * * SUN') {
      ctx.waitUntil(autoClockoutAll(env));
    } else {
      ctx.waitUntil(autoClockout6h(env));
      ctx.waitUntil((async () => {
        const SOURCE_GUILD  = "1500975724750704661";
        const TARGET_GUILD  = "1382167184607940658";
        const REQUIRED_ROLE = "1501250580058870104";
        try {
          // Sync pseudos
          const members = await discordFetch(`${DISCORD_API}/guilds/${SOURCE_GUILD}/members?limit=1000`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          }).then(r => r.json());
          for (const m of members) {
            const uid = m.user?.id;
            if (!uid) continue;
            await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members/${uid}`, {
              method: "PATCH",
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
              body: JSON.stringify({ nick: m.nick || null })
            });
          }
          // Kick membres sans rôle SASP requis
          const targetMembers = await discordFetch(`${DISCORD_API}/guilds/${TARGET_GUILD}/members?limit=1000`, {
            headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
          }).then(r => r.json());
          for (const m of targetMembers) {
            if (m.user?.bot) continue;
            const uid = m.user?.id;
            if (!uid) continue;
            const saspMember = await discordFetch(`${DISCORD_API}/guilds/${SOURCE_GUILD}/members/${uid}`, {
              headers: { "Authorization": `Bot ${env.DISCORD_BOT_TOKEN}` }
            }).then(r => r.status === 200 ? r.json() : null).catch(() => null);
            if (!saspMember || !(saspMember.roles || []).includes(REQUIRED_ROLE)) {
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
