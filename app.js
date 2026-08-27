// ══════════════════════════════════════════════════════════════════
//  CENTRALE PA — app.js
// ══════════════════════════════════════════════════════════════════

// ── Config locale (overrides depuis localStorage) ───────────────────
(function() {
  try {
    var cfg = JSON.parse(localStorage.getItem('sasp_permissions') || '{}');
    if (cfg.roleAdminIds  && cfg.roleAdminIds.length)  ROLE_ADMIN_IDS  = cfg.roleAdminIds;
    if (cfg.roleAcademyId && cfg.roleAcademyId.length) ROLE_ACADEMY_ID = cfg.roleAcademyId;
    if (cfg.roleAgentId   && cfg.roleAgentId.length)   ROLE_AGENT_ID   = cfg.roleAgentId;
    if (cfg.ftfRoleId     && cfg.ftfRoleId.length)     FTF_ROLE_ID     = cfg.ftfRoleId;
    if (cfg.cidRoleId     && cfg.cidRoleId.length)     CID_ROLE_ID     = cfg.cidRoleId;
  } catch(e) {}
})();

// ── State ──────────────────────────────────────────────────────────
var S = { user: null, appUser: null, role: 'agent', page: 'dashboard', pd: {}, discordRoles: [], discordUserId: null };

function isAuthDisabled() {
  return typeof AUTH_DISABLED !== 'undefined' && AUTH_DISABLED === true;
}

function makeOpenAccessUser() {
  var discordId = (typeof AUTH_BYPASS_DISCORD_ID !== 'undefined' && AUTH_BYPASS_DISCORD_ID) ? AUTH_BYPASS_DISCORD_ID : '';
  return {
    id: discordId || 'open-access',
    email: 'acces-libre@sasp.local',
    user_metadata: {
      full_name: 'Acces libre',
      name: 'Acces libre',
      user_name: 'Acces libre',
      provider_id: discordId
    },
    identities: discordId ? [{ provider: 'discord', id: discordId, identity_data: { sub: discordId } }] : []
  };
}

async function startOpenAccess() {
  var role = (typeof AUTH_BYPASS_ROLE !== 'undefined' && AUTH_BYPASS_ROLE) ? AUTH_BYPASS_ROLE : 'admin';
  var anonSession = await DB.ensureAnonymousSession();
  if (!anonSession) throw new Error('Active Anonymous sign-ins dans Supabase pour charger les donnees sans Discord.');
  S.user = makeOpenAccessUser();
  if (anonSession && anonSession.user && anonSession.user.id) S.user.id = anonSession.user.id;
  S.appUser = { user_id: S.user.id, nom: 'libre', prenom: 'Acces', app_role: role };
  S.role = role;
  S.discordRoles = [];
  S.discordUserId = (typeof AUTH_BYPASS_DISCORD_ID !== 'undefined' && AUTH_BYPASS_DISCORD_ID) ? AUTH_BYPASS_DISCORD_ID : null;
  S.serverNick = 'Acces libre';
  _grades = await DB.getGrades();
  _units = await DB.getUnits();
  await loadWikiSections();
  showApp();
  await navigate('dashboard');
}

// ── Salaires par grade ($/h) ─────────────────────────────────────────
var GRADE_SALAIRE = {
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
  'Rookie':              150
};
function calcSalaire(grade, seconds) {
  var rate = GRADE_SALAIRE[grade] || GRADE_SALAIRE['Trooper II'];
  return Math.round((seconds / 3600) * rate);
}
function fmtMoney(n) { return '$' + n.toLocaleString('fr-FR'); }
function parseMoneyInput(v) {
  var cleaned = String(v || '').replace(/\D/g, '');
  var n = parseInt(cleaned || '0', 10);
  return Math.max(0, n);
}

// ── Discord logs ────────────────────────────────────────────────────
var WORKER_BASE = 'https://sasp-intranet-bot.louisleurin.workers.dev';
var LOG_WORKER  = WORKER_BASE + '/log';
var LOG_TOKEN   = 'SASPlogs2026!';
var TRACKED_DIVISIONS = ['CID','SWAT','PA','CNU','TU','SYND','LP','FTF','K9','IA']; // doit rester aligne sur DIVISION_ROLE_SETS (worker.js)

function refreshAgentList() {
  DB.getAgents({}).then(function(agents) {
    fetch(WORKER_BASE + '/update-agent-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
      body: JSON.stringify({ agents: agents.map(function(a) { return { matricule: a.matricule, prenom: a.prenom, nom: a.nom, telephone: a.telephone }; }) })
    }).catch(function(e) { console.warn('refreshAgentList:', e); });
  }).catch(function(e) { console.warn('refreshAgentList fetch agents:', e); });
}

function syncDiscordRoles(discordId, addCodes, removeCodes) {
  if (!discordId || (!addCodes.length && !removeCodes.length)) return;
  fetch(WORKER_BASE + '/sync-member-roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
    body: JSON.stringify({ discord_id: discordId, add_codes: addCodes, remove_codes: removeCodes })
  }).catch(function(e) { console.warn('Discord role sync error:', e); });
}

function refreshPointeuseDiscordMessage() {
  fetch(WORKER_BASE + '/refresh-pointeuse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
    body: JSON.stringify({ site: 'sud' })
  }).catch(function(e) { console.warn('refresh pointeuse error:', e); });
}

var _discordRosterCache = { key: '', ts: 0, map: {} };
async function getDiscordRosterMap(agents) {
  var ids = (agents || []).map(function(a){ return a.discord_id; }).filter(Boolean).sort();
  if (!ids.length) return {};
  var key = ids.join(',');
  if (_discordRosterCache.key === key && Date.now() - _discordRosterCache.ts < 60000) return _discordRosterCache.map;
  var pairs = await Promise.all(ids.map(async function(id) {
    var res = await fetch(WORKER_BASE + '/get-member-roles?discord_id=' + encodeURIComponent(id));
    var data = await res.json();
    return data && data.ok ? [id, data] : null;
  }));
  var map = {};
  pairs.forEach(function(pair){ if (pair) map[pair[0]] = pair[1]; });
  _discordRosterCache = { key: key, ts: Date.now(), map: map };
  return _discordRosterCache.map;
}
function applyDiscordGrades(agents, roleMap) {
  roleMap = roleMap || {};
  return (agents || []).map(function(a) {
    var entry = a.discord_id ? roleMap[a.discord_id] : null;
    return entry && entry.grade ? Object.assign({}, a, { grade: entry.grade }) : a;
  });
}
async function getDiscordGradeCounts() {
  var res = await fetch(WORKER_BASE + '/grade-role-counts?t=' + Date.now(), { cache: 'no-store' });
  var data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erreur Discord');
  return data.counts || {};
}

async function syncGradesFromDiscord(btn) {
  var orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Analyse…';
  try {
    var res = await fetch(WORKER_BASE + '/admin/sync-grades-from-discord', { headers: { 'x-log-token': LOG_TOKEN } });
    var data = await res.json();
    if (data.ok) {
      showToast('✅ ' + data.updated + ' grade(s) mis à jour, ' + data.unchanged + ' inchangé(s)', 'success');
      if (data.updated > 0) await renderAgents();
    } else {
      showToast('❌ Erreur : ' + data.error, 'error');
    }
  } catch(e) {
    showToast('❌ ' + e.message, 'error');
  }
  btn.textContent = orig;
  btn.disabled = false;
}

async function syncAgentsFromDiscord() {
  if (!confirm('Synchroniser les rôles Discord vers les fiches SASP ?\n\nLes grades, divisions CID/SWAT/PA/CNU/TU/SYND et PPA seront mis à jour pour chaque agent qui a un Discord ID.')) return;
  var loader = toastLoading('Synchronisation en cours…');
  try {
    var agents = await DB.getAgents({});
    var withId = agents.filter(function(a) { return a.discord_id; });
    if (!withId.length) { loader.done('Aucun agent avec un Discord ID.', 'error'); return; }
    loader.update('Synchronisation en cours…');
    var roleMap = await getDiscordRosterMap(withId);
    var updated = 0;
    var changeLines = [];
    for (var i = 0; i < withId.length; i++) {
      var a = withId[i];
      if (!roleMap[a.discord_id]) continue; // pas trouvé sur Discord → on ne touche pas la fiche
      var entry = roleMap[a.discord_id];
      var nonTracked = (a.unites || []).filter(function(u) { return !TRACKED_DIVISIONS.includes(u); });
      var newUnites = nonTracked.concat(entry.divisions || []);
      var patch = {};
      var diff = [];
      if (JSON.stringify(newUnites.slice().sort()) !== JSON.stringify((a.unites || []).slice().sort())) {
        patch.unites = newUnites;
        var added = (entry.divisions || []).filter(function(d){ return !(a.unites||[]).includes(d); });
        var removed = (a.unites||[]).filter(function(d){ return TRACKED_DIVISIONS.includes(d) && !(entry.divisions||[]).includes(d); });
        if (added.length) diff.push('+' + added.join(', +'));
        if (removed.length) diff.push('-' + removed.join(', -'));
      }
      if (!!entry.ppa1 !== !!a.ppa1) { patch.ppa1 = entry.ppa1; diff.push((entry.ppa1?'+':'-') + 'PPA1'); }
      if (!!entry.ppa2 !== !!a.ppa2) { patch.ppa2 = entry.ppa2; diff.push((entry.ppa2?'+':'-') + 'PPA2'); }
      if (!!entry.ppa3 !== !!a.ppa3) { patch.ppa3 = entry.ppa3; diff.push((entry.ppa3?'+':'-') + 'PPA3'); }
      if (entry.grade && entry.grade !== a.grade) { patch.grade = entry.grade; diff.push('Grade: ' + (a.grade||'—') + ' → ' + entry.grade); }
      if (Object.keys(patch).length) {
        await DB.updateAgent(a.id, patch);
        updated++;
        changeLines.push('**' + esc(a.prenom) + ' ' + esc(a.nom) + '** (' + esc(a.matricule) + ') — ' + diff.join(', '));
      }
    }
    loader.done(updated + ' fiche(s) mise(s) à jour depuis Discord.');
    refreshAgentList();
    var desc = changeLines.length ? changeLines.join('\n') : 'Aucun changement détecté.';
    sendLog('🔄 Sync Discord → SASP', 0x3498db, [
      { name: 'Par', value: _whoAmI(), inline: true },
      { name: 'Agents vérifiés', value: String(withId.length), inline: true },
      { name: 'Fiches mises à jour', value: String(updated), inline: true },
      { name: 'Détail', value: desc.slice(0, 1024), inline: false }
    ]);
    if (S.page === 'agents') await renderAgents();
    else if (S.page === 'dashboard') await renderDashboard();
    else if (S.page === 'recap') await renderRecap();
  } catch(e) { loader.done('Erreur : ' + e.message, 'error'); }
}

async function syncDiscordToAgent(agentId) {
  var ag = await DB.getAgent(agentId);
  if (!ag || !ag.discord_id) { toast('Pas de Discord ID sur cette fiche.', 'error'); return; }
  try {
    var res = await fetch(WORKER_BASE + '/get-member-roles?discord_id=' + ag.discord_id);
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erreur Discord');
    var nonTracked = (ag.unites || []).filter(function(u) { return !TRACKED_DIVISIONS.includes(u); });
    var newUnites = nonTracked.concat(data.divisions || []);
    var patch = { unites: newUnites };
    if (data.grade) patch.grade = data.grade;
    if (typeof data.ppa1 === 'boolean') patch.ppa1 = data.ppa1;
    if (typeof data.ppa2 === 'boolean') patch.ppa2 = data.ppa2;
    if (typeof data.ppa3 === 'boolean') patch.ppa3 = data.ppa3;
    await DB.updateAgent(agentId, patch);
    toast('Fiche synchronisée depuis Discord ✓', 'success');
    await renderAgentProfile();
  } catch(e) { toast('Erreur : ' + e.message, 'error'); }
}
function _whoAmI() {
  if (!S.user) return '—';
  var m = S.user.user_metadata || {};
  return m.full_name || m.name || m.user_name || S.user.email || '—';
}
function sendLog(title, color, fields) {
  try {
    fetch(LOG_WORKER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
      body: JSON.stringify({ embed: { title: title, color: color, fields: fields || [] } })
    });
  } catch(e) {}
}
var _quill = null;
var _charts = {};
var _agentPage = 1;
var _agentFilters = { statut: '', grade: '', unite: '', search: '' };
var _grades = [];
var _units  = [];
var _mdtCats = [];
var _mdtSelCat = null;
var _mdtSelPage = null;
var _vehicleCatId = null;
var _vehiclePages = [];
var _wikiCats     = {};
var _wikiPages    = {};
var _wikiSlug     = null;
var _wikiSections = [];
var _ceremonieArchives = [];

var NAV = [
  { id: 'faq',      icon: '❓', label: 'FAQ' },
  { id: 'dashboard', icon: '🏛️', label: 'Tableau de bord' },
  { divider: true },
  { group: 'RESSOURCES HUMAINES' },
  { id: 'recap',    icon: '📋', label: 'Récap agents', staffOnly: true },
  { id: 'completude', icon: '🗂️', label: 'Complétude fiches', staffOnly: true },
  { id: 'agents',   icon: '👮', label: 'Agents' },
  { id: 'grades',   icon: '🎖️', label: 'Grades' },
  { id: 'units',     icon: '🚔', label: 'Divisions' },
  { id: 'pointeuse', icon: '⏱️', label: 'Pointeuse' },
  { id: 'cartes',   icon: '🗺️', label: 'Cartes' },
  { divider: true },
  { id: 'ftf',      icon: '🎯', label: 'Fugitive Task Force', ftfOnly: true },
  // wiki sections injected dynamically by loadWikiSections()
  { divider: true, staffOnly: true, _wikiEnd: true },
  { group: 'ADMINISTRATION', staffOnly: true },
  { id: 'archives',        icon: '🗃️', label: 'Archives',          staffOnly: true, hidden: true },
  { id: 'stats',           icon: '📈', label: 'Statistiques',       staffOnly: true },
  { id: 'service-logements', icon: '🏠', label: 'Logements service', adminOnly: true },
  { id: 'ticketing', icon: '🎫', label: 'Tickets Discord', adminOnly: true, hidden: true },
  { divider: true, ceremonyOnly: true },
  { id: 'ceremonie', icon: '🎖️', label: 'Montées en grade', ceremonyOnly: true },
];

var REMOVED_PAGES = ['cid', 'archives'];

var PAGE_TITLES = {
  dashboard:'Tableau de bord', agents:'Agents', 'agent-profile':'Fiche agent',
  grades:'Grades', units:'Divisions', pointeuse:'Pointeuse', 'pointeuse-historique':'Historique pointages', mdt:'Guide MDT', vehicles:'Véhicules', cartes:'Cartes',
  faq:'FAQ',
  info:'Informations', manuel:'Manuel', tenue:'Tenues', document:'Documents',
  archives:'Archives', ceremonie:'Prépa Cérémonie', completude:'Complétude fiches',
  'global-settings':'Réglages globaux',
  'service-logements':'Logements de service',
  ticketing:'Tickets Discord',
  cid:'CID', ftf:'FTF', 'ftf-dossier':'Dossier FTF', stats:'Statistiques', search:'Recherche', settings:'Mon compte'
};

// ── Boot ───────────────────────────────────────────────────────────
(async function boot() {
  if (isAuthDisabled()) {
    try {
      await startOpenAccess();
    } catch(e) {
      console.error('[auth] open access failed:', e);
      showLogin();
    }
    return;
  }
  var isOAuthReturn = /[?&](code|error|error_description)=/.test(window.location.search || '');
  try {
    var redirectSession = await DB.finishOAuthRedirect();
    var session = redirectSession || (await DB.getSession()).data.session;
    if (session) { await afterLogin(session.user, session); }
    else {
      showLogin();
      if (isOAuthReturn) {
        var loginErr = document.getElementById('loginErr');
        if (loginErr) { loginErr.textContent = 'Session Discord non recuperee. Recharge la page puis reessaie la connexion.'; loginErr.classList.add('show'); }
      }
    }
  } catch(e) {
    console.error('[auth] boot failed:', e);
    showLogin();
    var errEl = document.getElementById('loginErr');
    if (errEl) { errEl.textContent = 'Erreur retour Discord: ' + (e.message || e); errEl.classList.add('show'); }
  }
  DB.onAuthChange(async function(event, session) {
    if (event === 'SIGNED_IN' && session && !S.user) { await afterLogin(session.user, session); }
    if (event === 'SIGNED_OUT') { S.user = null; S.role = 'agent'; showLogin(); }
  });
})();

// ── Auth ───────────────────────────────────────────────────────────
async function doDiscordLogin() {
  var btn = document.getElementById('loginBtn');
  var txt = document.getElementById('loginBtnTxt');
  var errEl = document.getElementById('loginErr');
  errEl.classList.remove('show');
  btn.disabled = true;
  txt.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span> Redirection…';
  try {
    var { error } = await DB.loginWithDiscord();
    if (error) throw error;
  } catch(err) {
    errEl.textContent = '⚠ ' + (err.message || 'Erreur de connexion Discord.');
    errEl.classList.add('show');
    btn.disabled = false;
    txt.textContent = 'Se connecter avec Discord';
  }
}

var WORKER_URL = 'https://sasp-intranet-bot.louisleurin.workers.dev';

async function getDiscordRole(discordUserId) {
  console.log('[auth] discordUserId:', discordUserId);
  if (!discordUserId) return { role: null, apiOk: false, roles: [] };
  try {
    var res = await fetch(WORKER_URL + '/auth/check-roles?user_id=' + encodeURIComponent(discordUserId));
    console.log('[auth] check-roles status:', res.status);
    if (!res.ok) return { role: null, apiOk: false, roles: [] };
    var data = await res.json();
    console.log('[auth] roles from worker:', data.roles);
    console.log('[auth] is_owner:', data.is_owner, 'debug:', data.debug);
    var roles = data.roles || [];
    if (data.is_owner) return { role: 'admin', apiOk: true, roles: roles };
    if (ROLE_ADMIN_IDS.some(function(r){ return roles.indexOf(r) !== -1; })) return { role: 'admin', apiOk: true, roles: roles };
    // Ordre volontaire : les roles d'encadrement priment sur le grade, et le role
    // FTF prime aussi, sinon un agent FTF gradé obtiendrait l'acces complet.
    if (typeof ROLE_RH_ID !== 'undefined' && ROLE_RH_ID && roles.indexOf(ROLE_RH_ID) !== -1) return { role: 'rh', apiOk: true, roles: roles };
    if (typeof FTF_ROLE_ID !== 'undefined' && FTF_ROLE_ID && FTF_ROLE_ID !== 'ID_DU_ROLE_ICI' && roles.indexOf(FTF_ROLE_ID) !== -1) return { role: 'ftf', apiOk: true, roles: roles };
    if (roles.indexOf(ROLE_ACADEMY_ID) !== -1) return { role: 'academy', apiOk: true, roles: roles };
    if ((typeof ROLE_AGENT_IDS !== 'undefined' ? ROLE_AGENT_IDS : [ROLE_AGENT_ID]).some(function(r){ return roles.indexOf(r) !== -1; })) return { role: 'agent', apiOk: true, roles: roles };
    if (typeof ROLE_VISITEUR_ID !== 'undefined' && ROLE_VISITEUR_ID && roles.indexOf(ROLE_VISITEUR_ID) !== -1) return { role: 'visiteur', apiOk: true, roles: roles };
    if (typeof CID_ROLE_ID !== 'undefined' && CID_ROLE_ID && roles.indexOf(CID_ROLE_ID) !== -1) return { role: 'cid', apiOk: true, roles: roles };
    return { role: null, apiOk: true, roles: roles };
  } catch(e) { console.error('[auth] error:', e); return { role: null, apiOk: false, roles: [] }; }
}

async function afterLogin(user, session) {
  try {
    S.user = user;
    var discordIdentity = user.identities && user.identities.find(function(i){ return i.provider === 'discord'; });
    var discordUserId = (discordIdentity && (discordIdentity.id || (discordIdentity.identity_data && discordIdentity.identity_data.sub))) || (user.user_metadata && user.user_metadata.provider_id);
    S.discordUserId = discordUserId;
    console.log('[auth] identities:', user.identities, 'discordUserId:', discordUserId);
    var appUser = null;
    try { appUser = await DB.getAppUser(user.id); } catch(e) { console.warn('[auth] app user fetch failed:', e); }
    var result = await getDiscordRole(discordUserId);
    S.discordRoles = result.roles || [];
    if (result.role) {
      S.role = result.role;
      try {
        await DB.upsertAppUser({
          user_id: user.id,
          nom: (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.global_name || user.user_metadata.name)) || '',
          prenom: '',
          app_role: S.role
        });
      } catch(e) {
        console.warn('[auth] app user upsert failed:', e);
      }
    } else if (!result.apiOk && appUser && appUser.app_role) {
      S.role = appUser.app_role;
    } else {
      await DB.logout();
      showLogin();
      var errEl = document.getElementById('loginErr');
      if (errEl) { errEl.textContent = 'Acces refuse - vous n avez pas les roles requis sur le serveur Discord.'; errEl.classList.add('show'); }
      return;
    }
    _grades = await DB.getGrades();
    _units  = await DB.getUnits();
    await loadWikiSections();
    showApp();
    await navigate('dashboard');
  } catch(err) {
    console.error('[auth] afterLogin failed:', err);
    showLogin();
    var loginErr = document.getElementById('loginErr');
    if (loginErr) { loginErr.textContent = 'Erreur de connexion intranet: ' + (err.message || err); loginErr.classList.add('show'); }
  }
}

var _WIKI_DEFAULTS = [
  { slug:'info',     titre:'Informations', sous_titre:'Informations générales de la SASP',            icon:'ℹ️',  ordre:0 },
  { slug:'manuel',   titre:'Manuel',       sous_titre:'Procédures et protocoles opérationnels',     icon:'📋', ordre:1 },
  { slug:'tenue',    titre:'Tenues',       sous_titre:'Uniformes et équipements règlementaires',    icon:'👔', ordre:2 },
  { slug:'document', titre:'Documents',    sous_titre:'Documents et formulaires officiels',          icon:'📄', ordre:3 }
];

async function loadWikiSections() {
  try { _wikiSections = await DB.getWikiSections(); } catch(e) { _wikiSections = []; }
  if (!_wikiSections.length) _wikiSections = _WIKI_DEFAULTS.slice();
  // Rebuild NAV doc entries
  NAV = NAV.filter(function(n) { return !n._wiki; });
  var endIdx = -1;
  for (var i = 0; i < NAV.length; i++) { if (NAV[i]._wikiEnd) { endIdx = i; break; } }
  // wiki sections not shown in nav
  if (document.getElementById('sidebarNav')) buildNav();
}

async function doLogout() {

  await DB.logout();
  S.user = null; S.appUser = null; S.role = 'agent'; S.discordRoles = []; S.discordUserId = null;
  showLogin();
}

function showLogin() {
  document.getElementById('loginView').style.display = '';

  document.getElementById('appView').style.display = 'none';
  document.getElementById('loginBtnTxt').textContent = 'Se connecter avec Discord';
  document.getElementById('loginBtn').disabled = false;
  var errEl = document.getElementById('loginErr');
  if (errEl) errEl.classList.remove('show');
}

function showApp() {
  document.getElementById('loginView').style.display = 'none';

  document.getElementById('appView').style.display = '';
  buildNav();
  updateUserUI();
}

// ── Navigation ─────────────────────────────────────────────────────
function buildNav() {
  var isStaff = S.role === 'admin' || S.role === 'academy' || S.role === 'rh';
  var isCeremony = S.role === 'admin' || S.role === 'rh';
  var isVisiteur = S.role === 'visiteur';
  var isFtfOnly = S.role === 'ftf';
  var VISITEUR_NAV = ['dashboard', 'pointeuse', 'faq', 'cartes'];
  var RH_NAV = ['dashboard', 'agents', 'agent-profile', 'grades', 'units', 'pointeuse', 'faq', 'cartes', 'stats', 'recap', 'ceremonie', 'completude'];
  // Academie : FAQ, tableau de bord et Ressources humaines, pointeuse exclue.
  var ACADEMY_NAV = ['faq', 'dashboard', 'recap', 'completude', 'agents', 'grades', 'units', 'cartes'];
  var html = '';
  NAV.forEach(function(item) {
    if (item.hidden) return;
    if (item.ftfOnly && !canAccessFTF()) return;
    if (item.cidOnly && !canAccessCID()) return;
    if (isFtfOnly && item.id && item.id !== 'ftf') return;
    if (item.adminOnly && !isAdmin()) return;
    if (item.staffOnly && !isStaff) return;
    if (item.ceremonyOnly && !isCeremony) return;
    if (isVisiteur && item.id && !item.ftfOnly && !item.cidOnly && VISITEUR_NAV.indexOf(item.id) === -1) return;
    if (S.role === 'rh' && item.id && !item.ftfOnly && !item.cidOnly && RH_NAV.indexOf(item.id) === -1) return;
    if (S.role === 'academy') {
      // L'academie compte comme staff pour voir Recap et Completude, mais la
      // section Administration n'a rien a lui montrer : on masque son en-tete.
      if (item.staffOnly && (item.group || item.divider)) return;
      if (item.id && ACADEMY_NAV.indexOf(item.id) === -1) return;
    }
    if (item.divider) { html += '<div class="nav-divider"></div>'; return; }
    if (item.group)   { html += '<div class="nav-group">' + item.group + '</div>'; return; }
    html += '<div class="nav-item" data-page="' + item.id + '" onclick="navigate(\'' + item.id + '\')">' +
      '<span class="nav-icon">' + item.icon + '</span>' + esc(item.label) + '</div>';
  });
  document.getElementById('sidebarNav').innerHTML = html;

  var discordName = S.user && S.user.user_metadata && (S.user.user_metadata.full_name || S.user.user_metadata.name || S.user.user_metadata.user_name);
  var n = discordName || (S.appUser ? (S.appUser.prenom + ' ' + S.appUser.nom).trim() : S.user.email);
  var initials = n.split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
  var roleLabel = { admin:'ADMIN', academy:'SCA', agent:'AGENT', rh:'RH', visiteur:'VISITEUR', ftf:'FTF', cid:'CID' }[S.role] || S.role.toUpperCase();
  document.getElementById('sidebarFooter').innerHTML =
    '<div class="sidebar-user">' +
      '<div class="sidebar-avatar">' + initials + '</div>' +
      '<div><div class="sidebar-uname">' + esc(n) + '</div><div class="sidebar-urole">' + roleLabel + '</div></div>' +
      '<button class="sidebar-logout" onclick="doLogout()" title="Déconnexion">⏻</button>' +
    '</div>';

  var chipName = S.serverNick || n;
  var chipInitials = chipName.split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
  var userChip = document.getElementById('userChip');
  if (userChip) {
    userChip.innerHTML =
      '<div class="user-chip-av">' + chipInitials + '</div>' +
      '<span class="user-chip-name">' + esc(chipName) + '</span>';
  }
}

function updateUserUI() {
  document.querySelectorAll('.nav-item[data-page]').forEach(function(el) {
    el.classList.toggle('active', el.dataset.page === S.page);
  });
  var title = PAGE_TITLES[S.page] || S.page;
  var el = document.getElementById('pageTitle');
  if (el) el.textContent = title;
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

// ── Router ─────────────────────────────────────────────────────────
async function navigate(page, pd) {
  if (REMOVED_PAGES.indexOf(page) !== -1) {
    page = 'dashboard';
    pd = {};
  }
  S.page = page;
  S.pd = pd || {};
  updateUserUI();
  Object.values(_charts).forEach(function(c){ try{c.destroy();}catch(e){} });
  _charts = {};
  _quill = null;
  setContent('<div class="loader-block"><div class="spinner"></div><p>Chargement…</p></div>');
  var _permCfg = {}; try { _permCfg = JSON.parse(localStorage.getItem('sasp_permissions') || '{}'); } catch(e) {}
  var AGENT_ALLOWED   = _permCfg.agentPages   || ['dashboard','agents','agent-profile','grades','units','pointeuse','faq','mdt','vehicles','cartes','info','manuel','tenue','document'];
  var ACADEMY_ALLOWED = _permCfg.academyPages  || ['faq', 'dashboard', 'recap', 'completude', 'agents', 'agent-profile', 'grades', 'units', 'cartes'];
  if (page === 'ftf' && !canAccessFTF()) {
    setContent('<div class="empty-state"><div class="empty-icon">FTF</div><div class="empty-title">AccÃ¨s FTF restreint</div><div class="empty-sub">Cette page est rÃ©servÃ©e aux utilisateurs avec le rÃ´le Discord FTF.</div></div>');
    return;
  }
  if (page === 'cid' && !canAccessCID()) {
    setContent('<div class="empty-state"><div class="empty-icon">CID</div><div class="empty-title">Acces CID restreint</div><div class="empty-sub">Cette page est reservee aux utilisateurs avec le role Discord CID.</div></div>');
    return;
  }
  if ((page === 'service-logements' || page === 'ticketing') && !isAdmin()) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès réservé aux administrateurs</div><div class="empty-sub">La gestion des logements de service est réservée au Command Staff.</div></div>');
    return;
  }
  if (page === 'ftf') {
    setContent(renderFtfAccessGate());
    await wait(2400);
  }
  if (S.role === 'ftf' && page !== 'ftf') {
    await navigate('ftf');
    return;
  }
  if (page === 'ceremonie' && S.role !== 'admin' && S.role !== 'rh') {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div><div class="empty-sub">Cette section est réservée au Command Staff et aux Superviseurs.</div></div>');
    return;
  }
  var RH_ALLOWED = ['dashboard', 'agents', 'agent-profile', 'grades', 'units', 'pointeuse', 'faq', 'cartes', 'stats', 'recap', 'ceremonie'];
  if (S.role === 'rh' && page !== 'ftf' && RH_ALLOWED.indexOf(page) === -1) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div><div class="empty-sub">Cette section est réservée aux administrateurs.</div></div>');
    return;
  }
  var VISITEUR_ALLOWED = ['dashboard', 'pointeuse', 'faq', 'cartes'];
  if (S.role === 'visiteur' && page !== 'ftf' && VISITEUR_ALLOWED.indexOf(page) === -1) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div><div class="empty-sub">Votre rôle ne permet pas d\'accéder à cette section.</div></div>');
    return;
  }
  if (S.role === 'agent' && page !== 'ftf' && AGENT_ALLOWED.indexOf(page) === -1) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div><div class="empty-sub">Cette section est réservée au personnel d\'encadrement.</div></div>');
    return;
  }
  if (S.role === 'academy' && page !== 'ftf' && ACADEMY_ALLOWED && ACADEMY_ALLOWED.indexOf(page) === -1) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div><div class="empty-sub">Cette section est réservée aux administrateurs.</div></div>');
    return;
  }

  try {
    var renderers = {
      dashboard:      renderDashboard,
      faq:            renderFAQ,
      agents:         renderAgents,
      academie:       renderAcademie,
      recap:          renderRecap,
      'agent-profile':renderAgentProfile,
      grades:         renderGrades,
      units:          renderUnits,
      mdt:            renderMDT,
      vehicles:       renderVehicles,
      pointeuse:               renderPointeuse,
      'pointeuse-historique':  renderPointeuseHistorique,
      cartes:                  renderCartes,
      cid:                     renderCID3,
      ceremonie:      renderCeremonie,
      archives:       renderArchives,
      completude:     renderCompletude,
      'global-settings': renderGlobalSettings,
      'service-logements': renderServiceLogements,
      ticketing: renderTicketing,
      ftf:            renderFTF,
      'ftf-dossier':  renderFtfDossierPage,
      stats:          renderStats,
      search:         renderSearch,
      settings:       renderSettings
    };
    var fn = renderers[page];
    if (!fn) {
      for (var _wi = 0; _wi < _wikiSections.length; _wi++) {
        if (_wikiSections[_wi].slug === page) {
          var _ws = _wikiSections[_wi];
          fn = (function(s){ return function(){ return renderWikiSection(s.slug, {title:s.titre, sub:s.sous_titre||'', icon:s.icon||'📄'}); }; })(_ws);
          break;
        }
      }
    }
    if (fn) await fn();
    else setContent('<div class="empty-state"><div class="empty-icon">🚧</div><div class="empty-title">Page en construction</div></div>');
  } catch(err) {
    setContent('<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Erreur : ' + esc(err.message) + '</div></div>');
  }
  var sb = document.getElementById('sidebar');
  if (sb && sb.classList.contains('open')) toggleSidebar();
}

function setContent(html) {
  var el = document.getElementById('mainContent');
  el.innerHTML = html;
  el.classList.remove('page-in');
  void el.offsetWidth;
  el.classList.add('page-in');
}

function wait(ms) {
  return new Promise(function(resolve) { window.setTimeout(resolve, ms); });
}

// ── Modal ──────────────────────────────────────────────────────────
function openModal(opts) {
  document.getElementById('modalBox').className = 'modal-box' + (opts.size ? ' modal-' + opts.size : '');
  document.getElementById('modalHd').innerHTML =
    '<div><div class="modal-eye">' + esc(opts.eyebrow || '') + '</div><h2>' + (opts.title || '') + '</h2></div>' +
    '<button class="btn-close-m" onclick="closeModal()">✕</button>';
  document.getElementById('modalBody').innerHTML = opts.body || '';
  document.getElementById('modalFt').innerHTML = opts.footer || '';
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
function onModalOverlayClick(e) { if (e.target === document.getElementById('modalOverlay')) closeModal(); }

// ── Toast ──────────────────────────────────────────────────────────
function toast(msg, type) {
  type = type || 'info';
  var icons = { success:'✓', error:'✕', info:'⭐' };
  var el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = '<span>' + icons[type] + '</span><span>' + esc(msg) + '</span>';
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(function(){ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(function(){el.remove();}, 300); }, 3200);
}

function toastLoading(msg) {
  var el = document.createElement('div');
  el.className = 'toast toast-info';
  el.style.cssText = 'opacity:1;pointer-events:none';
  el.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite">⟳</span><span id="toastLoadingMsg">' + esc(msg) + '</span>';
  document.getElementById('toastContainer').appendChild(el);
  return {
    update: function(m) { var s = el.querySelector('#toastLoadingMsg'); if (s) s.textContent = m; },
    done: function(m, type) {
      el.className = 'toast toast-' + (type || 'success');
      el.innerHTML = '<span>' + (type === 'error' ? '✕' : '✓') + '</span><span>' + esc(m) + '</span>';
      setTimeout(function(){ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(function(){el.remove();}, 300); }, 3200);
    }
  };
}

// ── Permissions ────────────────────────────────────────────────────
function isAdmin() { return S.role === 'admin'; }
function canWrite() { return S.role === 'admin' || S.role === 'academy' || S.role === 'rh'; }
function canAccessFTF() {
  if (S.role === 'admin' || S.role === 'rh') return true;
  return typeof FTF_ROLE_ID !== 'undefined' &&
    FTF_ROLE_ID &&
    FTF_ROLE_ID !== 'ID_DU_ROLE_ICI' &&
    (S.discordRoles || []).indexOf(FTF_ROLE_ID) !== -1;
}

// ── Utils ──────────────────────────────────────────────────────────
function canAccessCID() {
  if (S.role === 'admin') return true;
  return typeof CID_ROLE_ID !== 'undefined' &&
    CID_ROLE_ID &&
    (S.discordRoles || []).indexOf(CID_ROLE_ID) !== -1;
}
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeHtml(s) { return esc(s); }
function escapeAttr(s) { return esc(s); }
function jsStr(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}
function canonicalGradeName(name) {
  return name === 'Senior Lead Officer' ? 'Senior Lead Trooper' : name;
}
function gradeLabel(name) {
  return canonicalGradeName(name || '');
}
function fmt(dateStr) {
  if (!dateStr) return '—';
  var d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function fmtShort(dateStr) {
  if (!dateStr) return '—';
  var d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
}
function fmtClock(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}
function statusBadge(s) {
  var map = { 'En service':'badge-green','En congé':'badge-blue','Suspendu':'badge-orange','Licencié':'badge-red','Retraité':'badge-gray','Démission':'badge-gray','Archivé':'badge-red' };
  return '<span class="badge ' + (map[s]||'badge-gray') + '">' + esc(s) + '</span>';
}
function gradeBadge(g) {
  g = gradeLabel(g);
  var pastille = (g === 'Rookie' || g === 'Trooper I') ? ' <span title="En formation" style="font-size:1.4em;vertical-align:middle">🎓</span>' : '';
  return '<span class="badge badge-gold">' + esc(g) + pastille + '</span>';
}
function unitBadge(u) {
  return '<span class="badge badge-blue">' + esc(u) + '</span>';
}
function typeIcon(t) {
  return { promotion:'🎖️', sanction:'⚠️', recompense:'🏅', note:'📋' }[t] || '📝';
}
function typeDotClass(t) {
  return 'tl-dot-' + (t || 'note');
}
function ppaCount(a) { return [a.ppa1,a.ppa2,a.ppa3].filter(Boolean).length; }

function normRosterText(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
function gradeKey(v) { return normRosterText(canonicalGradeName(v)); }
function isArchivedStatus(statut) { return normRosterText(statut) === 'archive'; }
function visibleRosterAgents(agents) {
  return (agents || []).filter(function(a){ return !isArchivedStatus(a.statut); });
}
function countAgentsByGrade(agents) {
  var counts = {};
  visibleRosterAgents(agents).forEach(function(a){
    var key = gradeKey(a.grade);
    if (key) counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}
async function getDashboardGradeCounts(grades, agents, logLabel) {
  try {
    var discordGradeCounts = await getDiscordGradeCounts();
    if (Object.keys(discordGradeCounts).length) {
      var discordByKey = {};
      Object.keys(discordGradeCounts).forEach(function(name) {
        discordByKey[gradeKey(name)] = discordGradeCounts[name] || 0;
      });
      var counts = {};
      (grades || []).forEach(function(g) {
        counts[gradeKey(g.nom)] = discordByKey[gradeKey(g.nom)] || 0;
      });
      return counts;
    }
  } catch(e) { console.warn(logLabel + ' Discord grade counts:', e); }
  return countAgentsByGrade(agents);
}

// ══ DASHBOARD ══════════════════════════════════════════════════════
var FTF_STORAGE_KEY = 'sasp_ftf_dossiers_v1';
var _ftfPhotosDraft = [];
var _ftfCurrentDossierId = null;
var FTF_CONVOCATION_TEMPLATE = 'assets/convocation-template.png?v=20260712-ftf-template-v2';
var FTF_STATUSES = ['Attente paiement', '1ère convocation', '2ème convocation', '3ème convocation', 'Tribunal', 'Clôturé'];
var _ftfTab = 'dashboard';
var _ftfSearch = '';
var _ftfStatus = '';
var _ftfArchiveView = 'active';
var _ftfNotifyRunning = false;
var _ftfDossiers = [];
var _ftfLoaded = false;

function ftfCurrentOrigin() {
  if (typeof SITE_LABEL !== 'undefined' && SITE_LABEL) return SITE_LABEL;
  if (typeof SITE_KEY !== 'undefined' && SITE_KEY === 'nord') return 'SASP NORD';
  return 'SASP SUD';
}
function ftfDossierOrigin(d) {
  if (d && d.origine_service) return d.origine_service;
  if (d && d.created_from_service) return d.created_from_service;
  if (d && d.source_site === 'nord') return 'SASP NORD';
  if (d && d.source_site === 'sud') return 'SASP SUD';
  return 'SASP SUD';
}
function ftfLoadDossiers() {
  return _ftfDossiers || [];
}
async function ftfFetchDossiers(force) {
  if (_ftfLoaded && !force) return _ftfDossiers;
  var res = await fetch(WORKER_BASE + '/ftf/dossiers?t=' + Date.now(), { cache: 'no-store' });
  var data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erreur chargement FTF');
  _ftfDossiers = data.dossiers || [];
  _ftfLoaded = true;
  try {
    var local = JSON.parse(localStorage.getItem(FTF_STORAGE_KEY) || '[]');
    if (!_ftfDossiers.length && Array.isArray(local) && local.length) {
      await ftfSaveDossiers(local);
      _ftfDossiers = local;
    }
  } catch(e) {}
  return _ftfDossiers;
}
async function ftfSaveDossier(dossier) {
  var res = await fetch(WORKER_BASE + '/ftf/dossiers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
    body: JSON.stringify({ dossier: dossier })
  });
  var data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erreur sauvegarde FTF');
  _ftfDossiers = _ftfDossiers.filter(function(d){ return d.id !== data.dossier.id; });
  _ftfDossiers.unshift(data.dossier);
  localStorage.setItem(FTF_STORAGE_KEY, JSON.stringify(_ftfDossiers));
  return data.dossier;
}
async function ftfSaveDossiers(list) {
  var res = await fetch(WORKER_BASE + '/ftf/dossiers/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
    body: JSON.stringify({ dossiers: list || [] })
  });
  var data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erreur sauvegarde FTF');
  _ftfDossiers = data.dossiers || list || [];
  localStorage.setItem(FTF_STORAGE_KEY, JSON.stringify(_ftfDossiers));
}
async function ftfDeleteDossierRemote(id) {
  var res = await fetch(WORKER_BASE + '/ftf/dossiers?id=' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: { 'x-log-token': LOG_TOKEN }
  });
  var data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erreur suppression FTF');
  _ftfDossiers = _ftfDossiers.filter(function(d){ return d.id !== id; });
  localStorage.setItem(FTF_STORAGE_KEY, JSON.stringify(_ftfDossiers));
}
function ftfTodayKey() {
  return new Date().toISOString().slice(0, 10);
}
function ftfAddDays(dateStr, days) {
  var d = new Date((dateStr || ftfTodayKey()) + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function ftfNextStep(statut) {
  return {
    'Attente paiement': '1ère convocation',
    '1ère convocation': '2ème convocation',
    '2ème convocation': '3ème convocation',
    '3ème convocation': 'Tribunal'
  }[statut] || '';
}
function ftfPreviousStep(statut) {
  return {
    '1ère convocation': 'Attente paiement',
    '2ème convocation': '1ère convocation',
    '3ème convocation': '2ème convocation',
    'Tribunal': '3ème convocation',
    'Clôturé': 'Tribunal'
  }[statut] || '';
}
function ftfDeadlineStart(d) {
  if (!d) return '';
  if (d.statut === 'Attente paiement') return d.date_notification || d.date_statut || '';
  return d.date_statut || d.date_notification || '';
}
function ftfNextStepInfo(d) {
  var next = ftfNextStep(d && d.statut);
  var start = ftfDeadlineStart(d);
  if (!next || !start) return '';
  return 'Etape suivante le ' + fmt(ftfAddDays(start, 7)) + ' : ' + next;
}
function ftfAmount(d) {
  var base = Number(d.montant_initial || 0);
  var mult = {
    'Attente paiement': 1,
    '1ère convocation': 1.25,
    '2ème convocation': 1.75,
    '3ème convocation': 2.25,
    'Tribunal': 2.25,
    'Clôturé': 2.25
  }[d.statut] || 1;
  return Math.round(base * mult);
}
function ftfConvocationLabel(d) {
  var next = ftfNextStep(d && d.statut);
  return next || (d && d.statut) || 'Convocation';
}
function ftfFormatConvocationDate(value) {
  if (!value) return '';
  var d = new Date(value + 'T12:00:00');
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });
}
function ftfFormatConvocationHour(value) {
  if (!value) return '';
  return String(value).replace(':', 'H');
}
function loadFtfImage(src) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function(){ resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}
async function buildFtfConvocationPng(d, dateValue, hourValue) {
  var img = await loadFtfImage(FTF_CONVOCATION_TEMPLATE);
  var canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  var ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.fillStyle = '#050505';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '700 31px Arial, sans-serif';
  ctx.fillText(((d.nom || '') + ' ' + (d.prenom || '')).trim().toUpperCase(), 725, 540, 380);
  ctx.font = '700 31px Arial, sans-serif';
  ctx.fillText(ftfFormatConvocationDate(dateValue), 655, 611, 245);
  ctx.fillText(ftfFormatConvocationHour(hourValue), 705, 682, 170);
  return canvas.toDataURL('image/png');
}
async function ftfAutoSendScheduledConvocations() {
  if (!canAccessFTF()) return;
  var list = ftfLoadDossiers().filter(function(d) {
    return d && d.convocation_validee && d.convocation_date && d.convocation_heure && !d.convocation_png_sent && !d.convocation_png_sending && !d.archived;
  });
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    d.convocation_png_sending = true;
    await ftfSaveDossier(d);
    try {
      var imageData = await buildFtfConvocationPng(d, d.convocation_date, d.convocation_heure);
      var res = await fetch(WORKER_BASE + '/ftf/send-convocation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
        body: JSON.stringify({
          dossier_id: d.id,
          creator_id: d.created_by_discord_id || S.discordUserId || '',
          suspect: ((d.prenom || '') + ' ' + (d.nom || '')).trim(),
          convocation: ftfConvocationLabel(d),
          date: ftfFormatConvocationDate(d.convocation_date),
          heure: ftfFormatConvocationHour(d.convocation_heure),
          source: ftfDossierOrigin(d),
          image_data: imageData
        })
      });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error((data && data.error) || 'Erreur envoi convocation');
      d.convocation_png_sent = true;
      d.convocation_png_sent_at = new Date().toISOString();
      d.convocation_png_message_id = data.message_id || '';
      delete d.convocation_png_sending;
      await ftfSaveDossier(d);
      toast('Convocation FTF envoyee pour ' + ((d.prenom || '') + ' ' + (d.nom || '')).trim() + '.', 'success');
    } catch(e) {
      delete d.convocation_png_sending;
      d.convocation_png_error = String((e && e.message) || e || 'Erreur');
      await ftfSaveDossier(d);
      toast('Erreur auto convocation FTF: ' + d.convocation_png_error, 'error');
    }
  }
}
function ftfFilteredDossiers() {
  var q = (_ftfSearch || '').toLowerCase().trim();
  return ftfLoadDossiers().filter(function(d) {
    var name = ((d.nom || '') + ' ' + (d.prenom || '')).toLowerCase();
    var archiveOk = _ftfArchiveView === 'all' || (_ftfArchiveView === 'archived' ? !!d.archived : !d.archived);
    return archiveOk && (!q || name.indexOf(q) !== -1) && (!_ftfStatus || d.statut === _ftfStatus);
  });
}
function ftfStatusBadge(statut) {
  var cls = {
    'Attente paiement': 'badge-blue',
    '1ère convocation': 'badge-gold',
    '2ème convocation': 'badge-orange',
    '3ème convocation': 'badge-red',
    'Tribunal': 'badge-red',
    'Clôturé': 'badge-green'
  }[statut] || 'badge-gray';
  return '<span class="badge ' + cls + '">' + esc(statut || 'Attente paiement') + '</span>';
}
function ftfTabButton(id, label, icon) {
  return '<button class="ftf-tab' + (_ftfTab === id ? ' active' : '') + '" onclick="ftfSetTab(\'' + id + '\')"><span class="ftf-tab-icon">' + icon + '</span><span>' + esc(label) + '</span></button>';
}
function ftfSetTab(tab) { _ftfTab = tab; renderFTF(); }
function ftfSetSearch(v) { _ftfSearch = v || ''; renderFTF(); }
function ftfSetStatus(v) { _ftfStatus = v || ''; renderFTF(); }
function ftfSetArchiveView(v) { _ftfArchiveView = v || 'active'; renderFTF(); }
function renderFTFStat(icon, label, value, sub) {
  return '<div class="ftf-stat"><div class="ftf-stat-top"><span>' + icon + '</span><strong>' + value + '</strong></div><div>' + esc(label) + '</div>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
}
function renderFtfAccessGate() {
  return '<div class="ftf-access-gate">' +
    '<div class="ftf-access-panel">' +
      '<div class="ftf-access-ring"><img src="assets/7_Glock_19_28.png" alt="FTF"></div>' +
      '<div class="ftf-kicker">FUGITIVE TASK FORCE</div>' +
      '<h1>Acc&egrave;s r&eacute;serv&eacute;</h1>' +
      '<p>V&eacute;rification de vos permissions Discord et ouverture du canal s&eacute;curis&eacute;.</p>' +
      '<div class="ftf-access-steps">' +
        '<span><i></i>Identit&eacute; confirm&eacute;e</span>' +
        '<span><i></i>R&ocirc;le FTF valid&eacute;</span>' +
        '<span><i></i>Dossiers partag&eacute;s charg&eacute;s</span>' +
      '</div>' +
      '<div class="ftf-access-bar"><i></i></div>' +
    '</div>' +
  '</div>';
}
async function renderFTF() {
  if (!canAccessFTF()) {
    setContent('<div class="empty-state"><div class="empty-icon">FTF</div><div class="empty-title">Acces FTF restreint</div><div class="empty-sub">Ajoutez l ID du role Discord FTF dans FTF_ROLE_ID pour autoriser cette page.</div></div>');
    return;
  }
  try {
    await ftfFetchDossiers();
  } catch(e) {
    setContent('<div class="empty-state"><div class="empty-icon">FTF</div><div class="empty-title">Erreur de chargement FTF</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>');
    return;
  }
  var dossiers = ftfLoadDossiers();
  var visibleDossiers = dossiers.filter(function(d){ return !d.archived; });
  var counts = {
    active: visibleDossiers.filter(function(d){ return d.statut !== 'Clôturé'; }).length,
    c1: visibleDossiers.filter(function(d){ return d.statut === '1ère convocation'; }).length,
    c2: visibleDossiers.filter(function(d){ return d.statut === '2ème convocation'; }).length,
    c3: visibleDossiers.filter(function(d){ return d.statut === '3ème convocation'; }).length,
    tribunal: visibleDossiers.filter(function(d){ return d.statut === 'Tribunal'; }).length,
    closed: visibleDossiers.filter(function(d){ return d.statut === 'Clôturé'; }).length
  };
  var body = _ftfTab === 'procedure' ? renderFTFProcedure() : (_ftfTab === 'dossiers' ? renderFTFDossiers() : _ftfTab === 'guide' ? renderFTFGuide() : renderFTFDashboard(counts));
  setContent(
    '<div class="ftf-page">' +
      '<div class="ftf-hero">' +
        '<div><div class="ftf-kicker">SASP · UNITE SPECIALE</div><h1>Fugitive Task Force</h1><p>Suivi des amendes impayees, convocations, localisations et transmissions tribunal.</p></div>' +
        '<div class="ftf-seal"><img src="assets/7_Glock_19_28.png" alt="Fugitive Task Force"></div>' +
      '</div>' +
      '<div class="ftf-tabs">' +
        ftfTabButton('dashboard', 'Tableau de bord', '01') +
        ftfTabButton('guide', 'Guide complet', '02') +
        ftfTabButton('procedure', 'Procedure', '03') +
        ftfTabButton('dossiers', 'Dossiers', '04') +
      '</div>' +
      body +
    '</div>'
  );
  ftfCheckConvocationNotifications();
  ftfAutoSendScheduledConvocations();
}
function renderFTFDashboard(counts) {
  var active = Number(counts.active || 0);
  var totalConv = Number(counts.c1 || 0) + Number(counts.c2 || 0) + Number(counts.c3 || 0);
  var tribunal = Number(counts.tribunal || 0);
  var closed = Number(counts.closed || 0);
  var pressure = active ? Math.min(100, Math.round(((totalConv + tribunal) / Math.max(active, 1)) * 100)) : 0;
  var tile = function(code, label, value, sub, tone) {
    return '<div class="ftf-dash-tile ftf-dash-' + tone + '">' +
      '<div class="ftf-dash-code">' + esc(code) + '</div>' +
      '<strong>' + esc(String(value)) + '</strong>' +
      '<h3>' + esc(label) + '</h3>' +
      '<p>' + esc(sub || '') + '</p>' +
    '</div>';
  };
  return '<div class="ftf-dashboard-ops">' +
    '<div class="ftf-command-panel">' +
      '<div><div class="ftf-kicker">TABLEAU DE BORD FTF</div><h2>Vue op\u00e9rationnelle</h2><p>Suivi instantan\u00e9 des dossiers actifs, convocations et transmissions tribunal.</p></div>' +
      '<div class="ftf-command-meter"><div style="--p:' + pressure + '%"><span>' + pressure + '%</span></div><small>pression dossiers</small></div>' +
    '</div>' +
    '<div class="ftf-dashboard-grid">' +
      tile('ACT', 'Dossiers actifs', active, 'hors dossiers cl\u00f4tur\u00e9s', 'blue') +
      tile('C1', 'Convocation 1', counts.c1, 'majoration +25 pourcent', 'gold') +
      tile('C2', 'Convocation 2', counts.c2, 'majoration +75 pourcent', 'orange') +
      tile('C3', 'Convocation 3', counts.c3, 'majoration +125 pourcent', 'red') +
      tile('TRB', 'Tribunal', tribunal, 'phase judiciaire', 'red') +
      tile('OK', 'Dossiers cl\u00f4tur\u00e9s', closed, 'proc\u00e9dure termin\u00e9e', 'green') +
    '</div>' +
    '<div class="ftf-dashboard-lanes">' +
      '<div><span>Recouvrement</span><strong>' + (active - tribunal) + '</strong><small>dossiers suivis avant tribunal</small></div>' +
      '<div><span>Convocations</span><strong>' + totalConv + '</strong><small>dossiers actuellement convoqu\u00e9s</small></div>' +
      '<div><span>Judiciaire</span><strong>' + tribunal + '</strong><small>dossiers \u00e0 pr\u00e9senter</small></div>' +
      '<div><span>Cl\u00f4ture</span><strong>' + closed + '</strong><small>dossiers termin\u00e9s</small></div>' +
    '</div>' +
  '</div>';
}
function renderFTFProcedure() {
  var stages = [
    { code:'PV', title:'Amende notifi\u00e9e', sub:'Notification SASP', detail:'La personne re\u00e7oit officiellement son amende. Le d\u00e9lai initial commence \u00e0 la date de l amende / d\u00e9lit.', tone:'blue' },
    { code:'J+7', title:'D\u00e9lai paiement', sub:'7 jours', detail:'Pendant 7 jours, le dossier reste en attente. Si la personne paie, la proc\u00e9dure s arr\u00eate.', tone:'gold' },
    { code:'FTF', title:'Transfert FTF', sub:'Impay\u00e9', detail:'Sans paiement, le dossier passe \u00e0 la Fugitive Task Force pour convocation et suivi.', tone:'gold' },
    { code:'C1', title:'1\u00e8re convocation', sub:'+25 pourcent', detail:'Nouveau d\u00e9lai de 7 jours. Non-pr\u00e9sentation \u00e0 la convocation judiciaire : +1 000 $.', tone:'orange' },
    { code:'C2', title:'2\u00e8me convocation', sub:'+75 pourcent', detail:'Deuxi\u00e8me convocation, m\u00eame d\u00e9lai de 7 jours. Le dossier devient prioritaire.', tone:'orange' },
    { code:'C3', title:'3\u00e8me convocation', sub:'+125 pourcent', detail:'Dernier rappel avant phase judiciaire. Pr\u00e9parer localisation et \u00e9l\u00e9ments de dossier.', tone:'red' },
    { code:'TRB', title:'Tribunal', sub:'Pr\u00e9sentation', detail:'Localisation, interpellation, pr\u00e9sentation tribunal et saisie des biens si n\u00e9cessaire.', tone:'red' }
  ];
  var stageHtml = stages.map(function(s, i) {
    return '<div class="ftf-flow-card ftf-flow-' + s.tone + '">' +
      '<div class="ftf-flow-code">' + esc(s.code) + '</div>' +
      '<div class="ftf-flow-body"><h3>' + esc(s.title) + '</h3><strong>' + esc(s.sub) + '</strong><p>' + esc(s.detail) + '</p></div>' +
      (i < stages.length - 1 ? '<div class="ftf-flow-line"></div>' : '') +
    '</div>';
  }).join('');
  var outcome = function(icon, title, text, cls) {
    return '<div class="ftf-outcome ' + cls + '"><div>' + icon + '</div><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></div>';
  };
  return '<div class="ftf-procedure-ops">' +
    '<div class="ftf-procedure-brief">' +
      '<div><div class="ftf-kicker">PROTOCOLE FTF</div><h2>Cycle de recouvrement</h2><p>Lecture rapide de la proc\u00e9dure compl\u00e8te, du premier d\u00e9lai de paiement jusqu \u00e0 la transmission tribunal.</p></div>' +
      '<div class="ftf-brief-badge"><strong>7</strong><span>jours par \u00e9tape</span></div>' +
    '</div>' +
    '<div class="ftf-flow">' + stageHtml + '</div>' +
    '<div class="ftf-outcomes">' +
      outcome('OK', 'Paiement re\u00e7u', 'Le dossier est cl\u00f4tur\u00e9 imm\u00e9diatement, quelle que soit l \u00e9tape en cours.', 'ok') +
      outcome('!', 'Absence convocation', 'Chaque non-pr\u00e9sentation \u00e0 une convocation judiciaire ajoute 1 000 $.', 'warn') +
      outcome('TRB', 'Apr\u00e8s C3', 'Localisation, interpellation, pr\u00e9sentation tribunal et saisie des biens.', 'danger') +
      outcome('$', 'Insolvabilit\u00e9', '\u00c9ch\u00e9ancier, TIG SASP/SAMC, pointage quotidien ou prison selon d\u00e9cision.', 'neutral') +
    '</div>' +
    '<div class="ftf-procedure-note"><span>NOTE</span><p><strong>Date 1\u00e8re amende / d\u00e9lit</strong> = d\u00e9part du premier d\u00e9lai. Apr\u00e8s chaque convocation trait\u00e9e, le d\u00e9lai repart automatiquement sur 7 jours.</p></div>' +
  '</div>';
}
function renderFTFGuide() {
  var card = 'background:linear-gradient(180deg,rgba(14,23,38,.94),rgba(7,12,21,.96));border:1px solid rgba(74,139,212,.13);border-radius:var(--rMd);padding:22px 26px;margin-bottom:16px;';
  var cardGold = card + 'border-left:3px solid rgba(201,168,76,.6);';
  var cardBlue = card + 'border-left:3px solid rgba(74,139,212,.6);';
  var cardRed  = card + 'border-left:3px solid rgba(220,80,80,.5);';
  var cardGreen= card + 'border-left:3px solid rgba(76,175,133,.5);';
  var h2 = 'font-family:Rajdhani,sans-serif;font-size:1.05rem;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold);margin-bottom:14px;display:flex;align-items:center;gap:10px;';
  var icon = function(e) { return '<span style="font-size:1.3rem;line-height:1">' + e + '</span>'; };
  var p = 'font-size:.86rem;color:var(--t2);line-height:1.75;margin:0 0 6px;';
  var warn = 'display:flex;align-items:flex-start;gap:10px;font-size:.82rem;color:#f0b429;background:rgba(240,180,41,.07);border:1px solid rgba(240,180,41,.2);border-radius:var(--rMd);padding:11px 14px;margin-top:12px;';
  var ok   = 'display:flex;align-items:flex-start;gap:10px;font-size:.82rem;color:#4caf85;background:rgba(76,175,133,.07);border:1px solid rgba(76,175,133,.2);border-radius:var(--rMd);padding:11px 14px;margin-top:12px;';

  // Timeline node helper
  var node = function(label, color, amt, sub) {
    return '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;min-width:100px">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:' + color + ';border:2px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;font-family:Rajdhani,sans-serif;font-size:.7rem;font-weight:800;letter-spacing:.5px;text-align:center;color:#fff;line-height:1.2;padding:4px">' + label + '</div>' +
      (amt ? '<div style="font-family:Share Tech Mono,monospace;font-size:.72rem;color:var(--gold);font-weight:700">' + amt + '</div>' : '') +
      (sub ? '<div style="font-size:.68rem;color:var(--t3);text-align:center;max-width:90px;line-height:1.3">' + sub + '</div>' : '') +
    '</div>';
  };
  var arrow = '<div style="flex:1;height:2px;background:linear-gradient(90deg,rgba(201,168,76,.4),rgba(201,168,76,.1));margin-top:-22px;min-width:12px"></div>';

  // How-to step helper
  var step = function(n, txt) {
    return '<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:10px">' +
      '<div style="width:24px;height:24px;border-radius:50%;border:1px solid rgba(201,168,76,.5);background:rgba(201,168,76,.1);color:var(--gold);font-family:Share Tech Mono,monospace;font-size:.64rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">' + n + '</div>' +
      '<div style="font-size:.86rem;color:var(--t2);line-height:1.65">' + txt + '</div>' +
    '</div>';
  };

  // Insolvabilité option card
  var opt = function(e, title, desc) {
    return '<div style="background:rgba(8,16,28,.6);border:1px solid rgba(255,255,255,.06);border-radius:var(--rMd);padding:14px;display:flex;flex-direction:column;gap:6px">' +
      '<div style="font-size:1.4rem">' + e + '</div>' +
      '<div style="font-family:Rajdhani,sans-serif;font-size:.9rem;font-weight:700;color:var(--t0)">' + title + '</div>' +
      '<div style="font-size:.78rem;color:var(--t3);line-height:1.5">' + desc + '</div>' +
    '</div>';
  };

  return '<div>' +

    // Intro
    '<div style="' + cardGold + '">' +
      '<div style="' + h2 + '">' + icon('🎯') + 'Fugitive Task Force — Vue d\'ensemble</div>' +
      '<p style="' + p + '">Unité chargée du <strong style="color:var(--t0)">recouvrement des amendes impayées</strong>. Intervient après l\'expiration du délai de paiement initial accordé par l\'agent verbalisateur. Les dossiers sont <strong style="color:var(--t0)">communs SASP Sud &amp; Nord</strong>.</p>' +
    '</div>' +

    // Timeline flow
    '<div style="' + card + 'border-left:3px solid rgba(201,168,76,.4);">' +
      '<div style="' + h2 + '">' + icon('📋') + 'Flux de la procédure</div>' +
      '<div style="display:flex;align-items:flex-start;gap:0;overflow-x:auto;padding-bottom:8px;flex-wrap:nowrap">' +
        node('AMENDE', 'rgba(74,139,212,.7)', '', 'Notification') + arrow +
        node('J+7', 'rgba(201,168,76,.35)', '', 'Paiement ?') + arrow +
        node('C1', 'rgba(240,140,30,.65)', '+25%', '7 jours') + arrow +
        node('C2', 'rgba(220,100,30,.65)', '+75%', '7 jours') + arrow +
        node('C3', 'rgba(200,60,60,.65)', '+125%', '7 jours') + arrow +
        node('TRIBUNAL', 'rgba(180,30,30,.8)', '', 'Localisation') +
      '</div>' +
      '<div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div style="' + ok.replace('margin-top:12px','') + '"><span>✅</span><span>Paiement à n\'importe quelle étape → dossier <strong>Clôturé</strong></span></div>' +
        '<div style="' + warn.replace('margin-top:12px','') + '"><span>⚠️</span><span>Non-présentation à une convocation = <strong>+1 000 $</strong> supplémentaires</span></div>' +
      '</div>' +
    '</div>' +

    // Créer un dossier
    '<div style="' + cardBlue + '">' +
      '<div style="' + h2 + '">' + icon('📁') + 'Créer un dossier</div>' +
      step(1, 'Aller dans l\'onglet <strong style="color:var(--t0)">Dossiers</strong> → bouton <strong style="color:var(--t0)">Créer un dossier</strong>') +
      step(2, 'Renseigner <strong style="color:var(--t0)">Nom</strong>, <strong style="color:var(--t0)">Prénom</strong>, <strong style="color:var(--t0)">montant initial</strong> et <strong style="color:var(--t0)">date de la 1ère amende</strong>') +
      step(3, 'Choisir le <strong style="color:var(--t0)">service créateur</strong> (SASP SUD ou SASP NORD) et remplir la raison + notes internes') +
      step(4, 'Sauvegarder → statut initial : <strong style="color:var(--t0)">Attente paiement</strong>. Le délai de 7 jours démarre à la date de la 1ère amende.') +
    '</div>' +

    // Avancer + Convocation
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">' +
      '<div style="' + cardGold + 'margin-bottom:0">' +
        '<div style="' + h2 + '">' + icon('⏩') + 'Avancer un dossier</div>' +
        step(1, 'Cliquer sur la ligne du dossier') +
        step(2, 'Cocher <strong style="color:var(--t0)">Convocation traitée → Oui</strong> pour passer à l\'étape suivante automatiquement') +
        step(3, 'Ou changer le <strong style="color:var(--t0)">Statut</strong> manuellement') +
        '<div style="font-size:.78rem;color:#f0b429;background:rgba(240,180,41,.07);border:1px solid rgba(240,180,41,.2);border-radius:var(--rMd);padding:9px 12px;margin-top:10px;">⚠️ Chaque changement remet le délai à 7 jours</div>' +
      '</div>' +
      '<div style="' + cardBlue + 'margin-bottom:0">' +
        '<div style="' + h2 + '">' + icon('📨') + 'Envoyer une convocation</div>' +
        step(1, 'Ouvrir le dossier → <strong style="color:var(--t0)">Envoyer convocation</strong>') +
        step(2, 'Choisir la <strong style="color:var(--t0)">date</strong> et l\'<strong style="color:var(--t0)">heure</strong> du rendez-vous') +
        step(3, 'Un <strong style="color:var(--t0)">PNG officiel</strong> est généré et envoyé dans le salon FTF avec un ping') +
        '<div style="font-size:.78rem;color:#4caf85;background:rgba(76,175,133,.07);border:1px solid rgba(76,175,133,.2);border-radius:var(--rMd);padding:9px 12px;margin-top:10px;">✅ Aussi planifiable directement depuis Discord via le rappel bot</div>' +
      '</div>' +
    '</div>' +

    // Tribunal
    '<div style="' + cardRed + '">' +
      '<div style="' + h2 + '">' + icon('⚖️') + 'Après 3 convocations — Tribunal</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
        '<div style="text-align:center;background:rgba(220,80,80,.08);border:1px solid rgba(220,80,80,.18);border-radius:var(--rMd);padding:14px 10px">' +
          '<div style="font-size:1.6rem;margin-bottom:6px">🔍</div>' +
          '<div style="font-family:Rajdhani,sans-serif;font-size:.85rem;font-weight:700;color:var(--t0);margin-bottom:4px">Localisation</div>' +
          '<div style="font-size:.76rem;color:var(--t3)">MDT, patrouille, renseignement</div>' +
        '</div>' +
        '<div style="text-align:center;background:rgba(220,80,80,.08);border:1px solid rgba(220,80,80,.18);border-radius:var(--rMd);padding:14px 10px">' +
          '<div style="font-size:1.6rem;margin-bottom:6px">🚔</div>' +
          '<div style="font-family:Rajdhani,sans-serif;font-size:.85rem;font-weight:700;color:var(--t0);margin-bottom:4px">Interpellation</div>' +
          '<div style="font-size:.76rem;color:var(--t3)">Présentation physique au tribunal</div>' +
        '</div>' +
        '<div style="text-align:center;background:rgba(220,80,80,.08);border:1px solid rgba(220,80,80,.18);border-radius:var(--rMd);padding:14px 10px">' +
          '<div style="font-size:1.6rem;margin-bottom:6px">💼</div>' +
          '<div style="font-family:Rajdhani,sans-serif;font-size:.85rem;font-weight:700;color:var(--t0);margin-bottom:4px">Saisie des biens</div>' +
          '<div style="font-size:.76rem;color:var(--t3)">Si montant recouvrable</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Insolvabilité
    '<div style="' + cardGreen + '">' +
      '<div style="' + h2 + '">' + icon('💸') + 'Insolvabilité — Options tribunal</div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">' +
        opt('📅', 'Échéancier', 'Paiement fractionné sur plusieurs semaines') +
        opt('🔧', 'TIG SASP/SAMC', 'Travaux d\'intérêt général en service') +
        opt('📍', 'Pointage quotidien', 'Présentation obligatoire chaque jour') +
        opt('🔒', 'Prison', 'En dernier recours sur décision judiciaire') +
      '</div>' +
    '</div>' +

    // Archiver
    '<div style="' + card + 'border-left:3px solid rgba(100,120,150,.4);display:flex;gap:20px;align-items:center">' +
      '<div style="font-size:2rem;flex-shrink:0">📦</div>' +
      '<div>' +
        '<div style="font-family:Rajdhani,sans-serif;font-size:.95rem;font-weight:700;color:var(--t0);margin-bottom:6px">Clôturer un dossier</div>' +
        '<p style="' + p + 'margin:0"><strong style="color:#4caf85">Archiver</strong> → dossier clôturé, consultable via le filtre "Archives" — <em>action recommandée</em><br><strong style="color:#e05555">Supprimer</strong> → suppression définitive — à réserver aux erreurs de saisie</p>' +
      '</div>' +
    '</div>' +

  '</div>';
}
function ftfRenderPhotosGrid() {
  var grid = _ftfPhotosDraft.map(function(p, i) {
    return '<div style="position:relative;width:84px;height:84px;flex-shrink:0">' +
      '<img src="' + esc(p.url) + '" style="width:84px;height:84px;object-fit:cover;border-radius:8px;cursor:pointer;border:1px solid rgba(255,255,255,.1);display:block" onclick="window.open(\'' + esc(p.url) + '\',\'_blank\')" title="' + esc(p.filename || '') + '">' +
      '<button onclick="ftfRemoveDraftPhoto(' + i + ')" style="position:absolute;top:-5px;right:-5px;width:20px;height:20px;border-radius:50%;background:#c0392b;border:none;color:#fff;font-size:.75rem;cursor:pointer;line-height:20px;text-align:center;padding:0;font-weight:700">×</button>' +
    '</div>';
  }).join('');
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;min-height:84px;align-items:flex-start">' + grid + '</div>';
}
window.ftfRemoveDraftPhoto = function(idx) {
  _ftfPhotosDraft.splice(idx, 1);
  var el = document.getElementById('ftfPhotosGrid');
  if (el) el.innerHTML = ftfRenderPhotosGrid();
};
async function ftfUploadPhoto() {
  var input = document.getElementById('ftfPhotoInput');
  if (!input || !input.files[0]) return;
  var file = input.files[0];
  input.value = '';
  var loader = toastLoading('Upload en cours...');
  try {
    var form = new FormData();
    form.append('file', file);
    form.append('dossier_id', _ftfCurrentDossierId || 'new');
    var res = await fetch(WORKER_BASE + '/ftf/upload-photo', {
      method: 'POST',
      headers: { 'x-log-token': LOG_TOKEN },
      body: form
    });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erreur upload');
    _ftfPhotosDraft.push({ url: data.url, filename: data.filename || file.name, uploaded_at: new Date().toISOString() });
    var el = document.getElementById('ftfPhotosGrid');
    if (el) el.innerHTML = ftfRenderPhotosGrid();
    loader.done('Photo ajoutée.', 'success');
  } catch(e) {
    loader.done('Erreur: ' + (e.message || e), 'error');
  }
}
window.ftfToggleMandat = function() {
  var v = document.getElementById('ftfMandatActif').value;
  var el = document.getElementById('ftfMandatFields');
  if (el) el.style.display = v === 'true' ? 'block' : 'none';
};
function ftfisNotificationDue(d) {
  return !!ftfNotificationToSend(d);
}
function ftfIsNotificationDue(d) {
  return !!ftfNotificationToSend(d);
}
function ftfNotificationToSend(d) {
  if (!d || d.archived || d.convocation_validee) return null;
  var next = ftfNextStep(d.statut);
  if (!next) return null;
  var start = ftfDeadlineStart(d);
  if (!start) return null;
  var today = ftfTodayKey();
  var warningDate = ftfAddDays(start, 6);
  var dueDate = ftfAddDays(start, 7);
  var type = today >= dueDate ? 'deadline' : (today >= warningDate ? 'warning' : '');
  if (!type) return null;
  var sentKey = d.statut + '|' + type + '|' + dueDate;
  if (d.notif_sent && d.notif_sent[sentKey] === true) return null;
  return { type: type, sentKey: sentKey, nextStep: next, dueDate: dueDate, warningDate: warningDate };
}
async function ftfCheckConvocationNotifications() {
  if (_ftfNotifyRunning || !canAccessFTF()) return;
  _ftfNotifyRunning = true;
  try {
    var dossiers = ftfLoadDossiers();
    var changed = false;
    for (var i = 0; i < dossiers.length; i++) {
      var d = dossiers[i];
      var notif = ftfNotificationToSend(d);
      if (!notif) continue;
      var res = await fetch(WORKER_BASE + '/ftf/convocation-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
        body: JSON.stringify({
          dossier_id: d.id,
          creator_id: d.created_by_discord_id || S.discordUserId || '',
          suspect: ((d.prenom || '') + ' ' + (d.nom || '')).trim(),
          current_status: d.statut,
          next_step: notif.nextStep,
          notification_type: notif.type,
          date_statut: ftfDeadlineStart(d),
          due_date: notif.dueDate,
          amount: ftfAmount(d),
          reason: d.raison_amende || ''
        })
      });
      if (res.ok) {
        d.notif_sent = d.notif_sent || {};
        d.notif_sent[notif.sentKey] = true;
        changed = true;
      }
    }
    if (changed) await ftfSaveDossiers(dossiers);
  } catch(e) {
    console.warn('FTF notifications:', e);
  } finally {
    _ftfNotifyRunning = false;
  }
}
function renderFTFDossiers() {
  var pendingAlerts = ftfLoadDossiers().filter(function(d){ return ftfIsNotificationDue(d); }).length;
  var list = ftfFilteredDossiers();
  var statusOptions = '<option value="">Tous les statuts</option>' + FTF_STATUSES.map(function(s){ return '<option value="' + esc(s) + '"' + (_ftfStatus === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
  var archiveOptions =
    '<option value="active"' + (_ftfArchiveView === 'active' ? ' selected' : '') + '>Dossiers actifs</option>' +
    '<option value="archived"' + (_ftfArchiveView === 'archived' ? ' selected' : '') + '>Archives</option>' +
    '<option value="all"' + (_ftfArchiveView === 'all' ? ' selected' : '') + '>Tous les dossiers</option>';
  var rows = list.length ? list.map(function(d) {
    var nextInfo = ftfNextStepInfo(d);
    var origin = ftfDossierOrigin(d);
    return '<tr onclick="navigate(\'ftf-dossier\',{id:\'' + esc(d.id) + '\'})" style="cursor:pointer">' +
      '<td><strong>' + esc((d.prenom || '') + ' ' + (d.nom || '')) + '</strong> <span class="badge badge-blue">' + esc(origin) + '</span>' + (d.archived ? ' <span class="badge badge-gray">Archive</span>' : '') + ((d.mandat && d.mandat.actif) ? ' <span class="badge badge-red" style="font-size:.65rem">⚠️ Mandat</span>' : '') + '<div class="text-muted" style="font-size:.72rem">' + esc(d.date_notification || '') + '</div></td>' +
      '<td>' + fmtMoney(Number(d.montant_initial || 0)) + '</td>' +
      '<td>' + ftfStatusBadge(d.statut) + (nextInfo ? '<div class="text-muted" style="font-size:.72rem;margin-top:4px">' + esc(nextInfo) + '</div>' : '') + '</td>' +
      '<td><strong class="text-gold">' + fmtMoney(ftfAmount(d)) + '</strong></td>' +
      '<td>' + esc((d.raison_amende || '—').slice(0, 90)) + (d.notes ? '<div class="text-muted" style="font-size:.72rem;margin-top:3px">' + esc(d.notes.slice(0, 70)) + '</div>' : '') + '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="5"><div class="empty-state" style="padding:28px"><div class="empty-icon">FTF</div><div class="empty-title">Aucun dossier FTF</div></div></td></tr>';
  return '<div class="card ftf-dossiers-card">' +
    '<div class="flex-between mb-20"><div><h2 style="font-size:1.2rem">Dossiers FTF</h2><p class="text-muted" style="font-size:.82rem">Date 1ere amende / delit = depart du premier delai. Apres chaque convocation, la date du statut relance le delai suivant.</p>' + (pendingAlerts ? '<p class="text-gold" style="font-size:.82rem;margin-top:4px">' + pendingAlerts + ' rappel(s) convocation en attente.</p>' : '') + '</div><button class="btn btn-primary btn-sm" onclick="openFtfDossierModal()">Creer un dossier</button></div>' +
    '<div class="ftf-toolbar">' +
      '<input class="form-control" value="' + esc(_ftfSearch) + '" oninput="ftfSetSearch(this.value)" placeholder="Rechercher par nom ou prenom">' +
      '<select class="form-control" onchange="ftfSetStatus(this.value)">' + statusOptions + '</select>' +
      '<select class="form-control" onchange="ftfSetArchiveView(this.value)">' + archiveOptions + '</select>' +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>PERSONNE</th><th>MONTANT INITIAL</th><th>STATUT</th><th>MONTANT ACTUEL</th><th>RAISON / NOTES</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
  '</div>';
}
async function renderFtfDossierPage() {
  var id = S.pd.id;
  if (!id) { navigate('ftf'); return; }
  var dossiers = await ftfFetchDossiers();
  var d = dossiers.find(function(x){ return x.id === id; });
  if (!d) { navigate('ftf'); return; }

  var origin = ftfDossierOrigin(d);
  var m = d.mandat || {};
  var photos = Array.isArray(d.photos) ? d.photos : [];
  var nextInfo = ftfNextStepInfo(d);
  var stepIdx = FTF_STATUSES.indexOf(d.statut);

  function row(label, val) {
    return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--border0)">' +
      '<span style="font-size:.78rem;color:var(--t3)">' + esc(label) + '</span>' +
      '<span style="font-size:.86rem;color:var(--t0);max-width:65%;text-align:right">' + val + '</span>' +
    '</div>';
  }

  var timelineHtml = '<div style="display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 10px">' +
    FTF_STATUSES.map(function(s, i) {
      var active = i === stepIdx, past = i < stepIdx;
      return '<div style="flex:1;min-width:90px;text-align:center;padding:7px 6px;border-radius:8px;font-size:.73rem;font-weight:' + (active ? '700' : '500') + ';' +
        'background:' + (active ? 'rgba(234,179,8,.15)' : past ? 'rgba(74,139,212,.08)' : 'var(--bg2)') + ';' +
        'color:' + (active ? 'var(--gold)' : past ? 'var(--blue)' : 'var(--t3)') + ';' +
        'border:1px solid ' + (active ? 'rgba(234,179,8,.4)' : past ? 'rgba(74,139,212,.2)' : 'var(--border0)') + '">' +
        esc(s) + '</div>';
    }).join('') +
  '</div>';

  var photosHtml = photos.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
        photos.map(function(p) {
          var url = typeof p === 'string' ? p : (p.url || '');
          return '<a href="' + esc(url) + '" target="_blank" style="display:block;width:110px;height:110px;border-radius:8px;overflow:hidden;border:1px solid var(--border0)">' +
            '<img src="' + esc(url) + '" style="width:100%;height:100%;object-fit:cover"></a>';
        }).join('') +
      '</div>'
    : '<div style="font-size:.82rem;color:var(--t3)">Aucune photo.</div>';

  var mandatHtml = m.actif
    ? row('Autorité', esc(m.autorite || '—')) +
      row('Date d\'émission', esc(m.date_emission || '—')) +
      row('Statut', '<span class="badge badge-red" style="font-size:.68rem">' + esc(m.statut || 'En cours') + '</span>') +
      (m.raison ? '<div style="margin-top:10px;font-size:.82rem;color:var(--t1);line-height:1.5">' + esc(m.raison) + '</div>' : '') +
      (m.notes ? '<div style="margin-top:6px;font-size:.76rem;color:var(--t3)">' + esc(m.notes) + '</div>' : '')
    : '<div style="font-size:.82rem;color:var(--t3)">Aucun mandat actif.</div>';

  setContent(
    '<button class="btn btn-ghost btn-sm mb-14" onclick="navigate(\'ftf\')">← Retour FTF</button>' +

    '<div class="profile-hd">' +
      '<div class="profile-av">⚖️</div>' +
      '<div style="flex:1">' +
        '<h1 class="profile-name">' + esc((d.prenom || '') + ' ' + (d.nom || '')) + '</h1>' +
        '<div class="profile-mat">' + esc(origin) + '</div>' +
        '<div class="profile-meta">' +
          ftfStatusBadge(d.statut) +
          (m.actif ? ' <span class="badge badge-red" style="font-size:.7rem">⚠️ Mandat actif</span>' : '') +
          (d.archived ? ' <span class="badge badge-gray">Archivé</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="profile-actions">' +
        '<button class="btn btn-outline btn-sm" onclick="openFtfDossierModal(\'' + esc(id) + '\')">✏️ Modifier</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="openFtfConvocationModal(\'' + esc(id) + '\')">📄 Convocation</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="toggleFtfArchive(\'' + esc(id) + '\')">' + (d.archived ? '📤 Restaurer' : '🗃️ Archiver') + '</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteFtfDossier(\'' + esc(id) + '\')">Supprimer</button>' +
      '</div>' +
    '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">' +
      '<div style="display:contents">' +

        '<div class="card">' +
          '<div class="card-head"><div class="card-icon">📋</div><div><div class="card-title">Informations</div></div></div>' +
          row('Montant initial', '<strong>' + esc(fmtMoney(Number(d.montant_initial || 0))) + '</strong>') +
          row('Montant actuel', '<strong class="text-gold">' + esc(fmtMoney(ftfAmount(d))) + '</strong>') +
          row('Date amende / délit', esc(d.date_notification || '—')) +
          row('Date statut', esc(d.date_statut || '—')) +
          row('Service créateur', esc(origin)) +
          (d.raison_amende ? '<div style="margin-top:10px;font-size:.82rem;color:var(--t1);line-height:1.5">' + esc(d.raison_amende) + '</div>' : '') +
        '</div>' +

        '<div class="card">' +
          '<div class="card-head"><div class="card-icon">📝</div><div><div class="card-title">Notes internes</div></div></div>' +
          (d.notes ? '<div style="font-size:.84rem;color:var(--t1);white-space:pre-wrap;line-height:1.5">' + esc(d.notes) + '</div>' : '<div style="font-size:.82rem;color:var(--t3)">Aucune note.</div>') +
        '</div>' +

        '<div class="card" style="grid-column:span 2">' +
          '<div class="card-head"><div class="card-icon">📊</div><div><div class="card-title">Progression du dossier</div></div></div>' +
          timelineHtml +
          (nextInfo ? '<p style="font-size:.78rem;color:var(--t3);margin:0">' + esc(nextInfo) + '</p>' : '') +
        '</div>' +

        (photos.length
          ? '<div class="card" style="grid-column:span 2">' +
              '<div class="card-head"><div class="card-icon">📸</div><div><div class="card-title">Photos / Pièces jointes (' + photos.length + ')</div></div></div>' +
              photosHtml +
            '</div>'
          : '') +

        '<div class="card">' +
          '<div class="card-head"><div class="card-icon">📜</div><div><div class="card-title">Mandat d\'arrêt</div></div></div>' +
          mandatHtml +
        '</div>' +

      '</div>' +
    '</div>'
  );
}

function openFtfDossierModal(id) {
  var dossiers = ftfLoadDossiers();
  var d = id ? dossiers.find(function(x){ return x.id === id; }) : null;
  var isEdit = !!d;
  d = d || { nom:'', prenom:'', montant_initial:'', date_notification:ftfTodayKey(), date_statut:ftfTodayKey(), statut:'Attente paiement', convocation_validee:false, origine_service:ftfCurrentOrigin(), raison_amende:'', notes:'', photos:[], mandat:{} };
  _ftfPhotosDraft = Array.isArray(d.photos) ? d.photos.slice() : [];
  _ftfCurrentDossierId = d.id || null;
  var origin = ftfDossierOrigin(d);
  var m = d.mandat || {};
  var mandatActif = !!m.actif;
  if (!d.date_statut) d.date_statut = d.date_notification || ftfTodayKey();
  var nextInfo = ftfNextStepInfo(d);
  var statusSelect = '<div class="form-group"><label class="form-label">Statut</label><select class="form-control" id="ftfStatut">' +
    FTF_STATUSES.map(function(s){ return '<option value="' + esc(s) + '"' + (d.statut === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
    '</select></div>';
  var validatedSelect = '<div class="form-group"><label class="form-label">Convocation traitee ?</label><select class="form-control" id="ftfConvocationValidee">' +
    '<option value="false" selected>Non</option>' +
    '<option value="true">Oui - passer a l etape suivante</option>' +
    '</select></div>';
  var sep = '<div style="border-top:1px solid rgba(255,255,255,.07);margin:16px 0"></div>';
  openModal({
    eyebrow: 'DOSSIER FTF',
    title: isEdit ? ((d.prenom || '') + ' ' + (d.nom || '')).trim() || 'Modifier le dossier' : 'Creer un dossier',
    size: 'lg',
    body:
      // Identité
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        fld('Nom *','text','ftfNom',d.nom,'Nom') +
        fld('Prenom *','text','ftfPrenom',d.prenom,'Prenom') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">' +
        fld('Montant initial *','number','ftfMontant',d.montant_initial,'15000') +
        fld('Date 1ere amende / delit','date','ftfDate',d.date_notification,'') +
        '<div class="form-group"><label class="form-label">Service createur</label><select class="form-control" id="ftfOrigineService">' +
          '<option value="SASP SUD"' + (origin === 'SASP SUD' ? ' selected' : '') + '>SASP SUD</option>' +
          '<option value="SASP NORD"' + (origin === 'SASP NORD' ? ' selected' : '') + '>SASP NORD</option>' +
        '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<input type="hidden" id="ftfDateStatut" value="' + esc(d.date_statut || '') + '">' +
        validatedSelect +
        statusSelect +
      '</div>' +
      (nextInfo ? '<div class="badge badge-gold" style="margin-bottom:14px">' + esc(nextInfo) + '</div>' : '') +
      '<div class="form-group"><label class="form-label">Raison de l amende</label><textarea class="form-control" id="ftfRaisonAmende" placeholder="Ex : refus d obtemperer, stationnement abusif...">' + esc(d.raison_amende || '') + '</textarea></div>' +
      '<div class="form-group"><label class="form-label">Notes FTF</label><textarea class="form-control" id="ftfNotes" placeholder="Notes internes FTF" style="min-height:60px">' + esc(d.notes || '') + '</textarea></div>' +

      // Photos
      sep +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<label class="form-label" style="margin:0">📸 Photos / Pièces jointes</label>' +
        '<label style="cursor:pointer;padding:6px 14px;background:rgba(74,139,212,.15);border:1px solid rgba(74,139,212,.3);border-radius:var(--rMd);font-size:.8rem;color:var(--blue);font-weight:600">' +
          'Ajouter une photo' +
          '<input type="file" id="ftfPhotoInput" accept="image/*" style="display:none" onchange="ftfUploadPhoto()">' +
        '</label>' +
      '</div>' +
      '<div id="ftfPhotosGrid">' + ftfRenderPhotosGrid() + '</div>' +

      // Mandat
      sep +
      '<div class="form-group"><label class="form-label">📜 Mandat d\'arrêt</label>' +
        '<select class="form-control" id="ftfMandatActif" onchange="ftfToggleMandat()" style="margin-bottom:10px">' +
          '<option value="false"' + (!mandatActif ? ' selected' : '') + '>Aucun mandat actif</option>' +
          '<option value="true"' + (mandatActif ? ' selected' : '') + '>Mandat actif</option>' +
        '</select>' +
      '</div>' +
      '<div id="ftfMandatFields" style="display:' + (mandatActif ? 'block' : 'none') + '">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          fld('Autorité émettrice','text','ftfMandatAutorite',m.autorite||'','Ex : Capitaine Miller') +
          fld('Date d\'émission','date','ftfMandatDate',m.date_emission||'','') +
        '</div>' +
        '<div class="form-group"><label class="form-label">Statut du mandat</label>' +
          '<select class="form-control" id="ftfMandatStatut">' +
            '<option value="En cours"' + (m.statut === 'En cours' || !m.statut ? ' selected' : '') + '>En cours</option>' +
            '<option value="Exécuté"' + (m.statut === 'Exécuté' ? ' selected' : '') + '>Exécuté</option>' +
            '<option value="Annulé"' + (m.statut === 'Annulé' ? ' selected' : '') + '>Annulé</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group"><label class="form-label">Raison du mandat</label><textarea class="form-control" id="ftfMandatRaison" placeholder="Ex : Fuite après interpellation, récidive..." style="min-height:60px">' + esc(m.raison||'') + '</textarea></div>' +
        '<div class="form-group"><label class="form-label">Notes mandat</label><textarea class="form-control" id="ftfMandatNotes" placeholder="Notes internes..." style="min-height:50px">' + esc(m.notes||'') + '</textarea></div>' +
      '</div>',
    footer:
      (isEdit && ftfPreviousStep(d.statut) ? '<button class="btn btn-outline" onclick="rollbackFtfDossier(\'' + esc(d.id) + '\')">← Étape précédente</button>' : '') +
      (isEdit ? '<button class="btn btn-outline" onclick="openFtfConvocationModal(\'' + esc(d.id) + '\')">Convocation PNG</button>' : '') +
      (isEdit ? '<button class="btn btn-outline" onclick="toggleFtfArchive(\'' + esc(d.id) + '\')">' + (d.archived ? 'Restaurer' : 'Archiver') + '</button>' : '') +
      (isEdit ? '<button class="btn btn-danger" onclick="deleteFtfDossier(\'' + esc(d.id) + '\')">Supprimer</button>' : '') +
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveFtfDossier(' + (isEdit ? '\'' + esc(d.id) + '\'' : 'null') + ')">Sauvegarder</button>'
  });
}
function openFtfConvocationModal(id) {
  var dossiers = ftfLoadDossiers();
  var d = dossiers.find(function(x){ return x.id === id; });
  if (!d) { toast('Dossier introuvable.', 'error'); return; }
  var defaultDate = ftfAddDays(ftfDeadlineStart(d), 7);
  var defaultHour = d.convocation_heure || '';
  openModal({
    eyebrow: 'CONVOCATION FTF',
    title: ((d.prenom || '') + ' ' + (d.nom || '')).trim(),
    size: 'sm',
    body:
      '<p class="text-muted" style="font-size:.86rem;line-height:1.6;margin-bottom:14px">Choisis la date et l heure souhaitees. Le PNG sera genere puis envoye dans le salon FTF.</p>' +
      '<div class="badge badge-gold" style="margin-bottom:14px">' + esc(ftfConvocationLabel(d)) + '</div>' +
      fld('Date de convocation *','date','ftfConvocationDate',d.convocation_date || defaultDate,'') +
      fld('Heure de convocation *','time','ftfConvocationHour',defaultHour,''),
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="sendFtfConvocation(\'' + esc(id) + '\')">Envoyer le PNG</button>'
  });
}
async function sendFtfConvocation(id) {
  var dossiers = ftfLoadDossiers();
  var d = dossiers.find(function(x){ return x.id === id; });
  if (!d) { toast('Dossier introuvable.', 'error'); return; }
  var dateValue = document.getElementById('ftfConvocationDate').value;
  var hourValue = document.getElementById('ftfConvocationHour').value;
  if (!dateValue || !hourValue) { toast('Date et heure requises.', 'error'); return; }
  var loader = toastLoading('Generation de la convocation...');
  try {
    var imageData = await buildFtfConvocationPng(d, dateValue, hourValue);
    var res = await fetch(WORKER_BASE + '/ftf/send-convocation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
      body: JSON.stringify({
        dossier_id: d.id,
        creator_id: d.created_by_discord_id || S.discordUserId || '',
        suspect: ((d.prenom || '') + ' ' + (d.nom || '')).trim(),
        convocation: ftfConvocationLabel(d),
        date: ftfFormatConvocationDate(dateValue),
        heure: ftfFormatConvocationHour(hourValue),
        source: ftfDossierOrigin(d),
        image_data: imageData
      })
    });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Erreur Discord');
    closeModal();
    loader.done('Convocation envoyee.', 'success');
  } catch(e) {
    loader.done('Erreur convocation: ' + (e.message || e), 'error');
  }
}
async function saveFtfDossier(id) {
  var nom = (document.getElementById('ftfNom').value || '').trim();
  var prenom = (document.getElementById('ftfPrenom').value || '').trim();
  var montant = parseMoneyInput(document.getElementById('ftfMontant').value);
  if (!nom || !prenom || !montant) { toast('Nom, prenom et montant requis.', 'error'); return; }
  var dossiers = ftfLoadDossiers();
  var previous = id ? dossiers.find(function(d){ return d.id === id; }) : null;
  var newStatus = document.getElementById('ftfStatut').value || 'Attente paiement';
  var advanceStep = document.getElementById('ftfConvocationValidee').value === 'true';
  if (advanceStep) newStatus = ftfNextStep(newStatus) || newStatus;
  var statusChanged = previous && previous.statut !== newStatus;
  var dateAmende = document.getElementById('ftfDate').value || ftfTodayKey();
  var dateStatut = id ? ((statusChanged || advanceStep) ? ftfTodayKey() : ((previous && previous.date_statut) || dateAmende)) : dateAmende;
  var data = {
    id: id || ('ftf_' + Date.now()),
    nom: nom,
    prenom: prenom,
    montant_initial: montant,
    date_notification: dateAmende,
    date_statut: dateStatut,
    statut: newStatus,
    convocation_validee: false,
    archived: previous ? !!previous.archived : false,
    archived_at: previous ? (previous.archived_at || '') : '',
    origine_service: document.getElementById('ftfOrigineService').value || ((previous && ftfDossierOrigin(previous)) || ftfCurrentOrigin()),
    source_site: (document.getElementById('ftfOrigineService').value === 'SASP NORD') ? 'nord' : 'sud',
    created_by_discord_id: (previous && previous.created_by_discord_id) || S.discordUserId || '',
    notif_sent: (statusChanged || advanceStep) ? {} : ((previous && previous.notif_sent) || {}),
    raison_amende: document.getElementById('ftfRaisonAmende').value || '',
    notes: document.getElementById('ftfNotes').value || '',
    photos: _ftfPhotosDraft.slice(),
    mandat: (function() {
      var actif = document.getElementById('ftfMandatActif') && document.getElementById('ftfMandatActif').value === 'true';
      if (!actif) return { actif: false };
      return {
        actif: true,
        autorite: (document.getElementById('ftfMandatAutorite') || {}).value || '',
        date_emission: (document.getElementById('ftfMandatDate') || {}).value || '',
        statut: (document.getElementById('ftfMandatStatut') || {}).value || 'En cours',
        raison: (document.getElementById('ftfMandatRaison') || {}).value || '',
        notes: (document.getElementById('ftfMandatNotes') || {}).value || ''
      };
    })(),
    updated_at: new Date().toISOString()
  };
  try {
    await ftfSaveDossier(data);
    closeModal();
    toast('Dossier FTF sauvegarde.', 'success');
    if (S.page === 'ftf-dossier') { S.pd = { id: data.id }; await renderFtfDossierPage(); } else renderFTF();
  } catch(e) {
    toast('Erreur sauvegarde FTF: ' + (e.message || e), 'error');
  }
}
async function deleteFtfDossier(id) {
  if (!confirm('Supprimer ce dossier FTF ?')) return;
  try {
    await ftfDeleteDossierRemote(id);
    closeModal();
    toast('Dossier FTF supprime.', 'info');
    renderFTF();
  } catch(e) {
    toast('Erreur suppression FTF: ' + (e.message || e), 'error');
  }
}
async function toggleFtfArchive(id) {
  var dossiers = ftfLoadDossiers();
  var archived = false;
  var found = false;
  var updated = null;
  dossiers.forEach(function(d) {
    if (d.id !== id) return d;
    found = true;
    archived = !d.archived;
    updated = Object.assign({}, d, {
      archived: archived,
      archived_at: archived ? new Date().toISOString() : '',
      updated_at: new Date().toISOString()
    });
  });
  if (!found) { toast('Dossier introuvable.', 'error'); return; }
  try {
    await ftfSaveDossier(updated);
    closeModal();
    toast(archived ? 'Dossier archive.' : 'Dossier restaure.', archived ? 'info' : 'success');
    if (S.page === 'ftf-dossier') await renderFtfDossierPage(); else renderFTF();
  } catch(e) {
    toast('Erreur archive FTF: ' + (e.message || e), 'error');
  }
}
async function rollbackFtfDossier(id) {
  var dossiers = ftfLoadDossiers();
  var changed = false;
  var updated = null;
  dossiers.forEach(function(d) {
    if (d.id !== id) return d;
    var previous = ftfPreviousStep(d.statut);
    if (!previous) return d;
    changed = true;
    updated = Object.assign({}, d, {
      statut: previous,
      date_statut: previous === 'Attente paiement' ? (d.date_notification || ftfTodayKey()) : ftfTodayKey(),
      convocation_validee: false,
      notif_sent: {},
      updated_at: new Date().toISOString()
    });
  });
  if (!changed) { toast('Aucune etape precedente disponible.', 'info'); return; }
  try {
    await ftfSaveDossier(updated);
    closeModal();
    toast('Etape precedente restauree.', 'success');
    if (S.page === 'ftf-dossier') await renderFtfDossierPage(); else renderFTF();
  } catch(e) {
    toast('Erreur retour etape FTF: ' + (e.message || e), 'error');
  }
}

async function renderDashboard() {
  _grades = await DB.getGrades();
  var agents = visibleRosterAgents(await DB.getAgents());
  var hist = [];
  try {
    var { data: histData } = await getDb().from('agent_historique')
      .select('*, agent:agent_id(nom,prenom,grade)')
      .order('created_at', { ascending: false }).limit(8);
    hist = histData || [];
  } catch(e) { hist = []; }

  var total   = agents.length;
  var actifs  = agents.filter(function(a){ return a.statut === 'En service'; }).length;
  var susp    = agents.filter(function(a){ return a.statut === 'Suspendu'; }).length;
  var recentR = agents.slice().sort(function(a,b){ return new Date(b.date_recrutement)-new Date(a.date_recrutement); }).slice(0,5);

  // Grade counts — tous les grades dans l'ordre hiérarchique
  var gradesSorted = _grades.slice().sort(function(a,b){ return (b.ordre||0)-(a.ordre||0); });
  var gradeCounts = await getDashboardGradeCounts(gradesSorted, agents, 'dashboard');
  var topGrades = gradesSorted.map(function(g){ return [gradeLabel(g.nom), gradeCounts[gradeKey(g.nom)]||0]; });

  var activityHtml = hist.length ? hist.map(function(h) {
    var dot = typeDotClass(h.type);
    var name = h.agent ? (h.agent.prenom + ' ' + h.agent.nom) : '—';
    return '<div class="activity-item">' +
      '<div class="activity-icon tl-dot ' + dot + '">' + typeIcon(h.type) + '</div>' +
      '<div class="activity-text"><div class="activity-title">' + esc(h.titre) + '</div>' +
      '<div class="activity-sub">' + esc(name) + ' · ' + esc(h.agent && h.agent.grade || '') + '</div></div>' +
      '<div class="activity-date">' + fmtShort(h.date) + '</div>' +
    '</div>';
  }).join('') : '<div class="empty-state" style="padding:30px"><div class="empty-icon">📋</div><div class="empty-title">Aucune activité récente</div></div>';

  var gradeListHtml = topGrades.map(function(g) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border0)">' +
      '<span style="font-size:.85rem;color:var(--t1)">' + esc(g[0]) + '</span>' +
      '<span class="badge badge-gold">' + g[1] + '</span></div>';
  }).join('');

  setContent(
    '<div class="welcome-bar">' +
      '<div><h1 style="font-size:1.5rem">Tableau de bord</h1>' +
      '<p class="text-muted" style="margin-top:3px;font-size:.84rem">SASP ·' + new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + '</p></div>' +
      (canWrite() ? '<button class="btn btn-primary btn-sm" onclick="navigate(\'agents\')" style="gap:6px">👮 Ajouter un agent</button>' : '') +
    '</div>' +

    '<div class="stats-grid">' +
      statCard('👮', 'Agents total', total) +
      statCard('✅', 'En service', actifs, 'badge-green') +
      statCard('⚠️', 'Suspendus', susp, 'badge-orange') +
      statCard('📋', 'Recrutements ce mois', recentR.length) +
    '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">' +
      '<div class="card">' +
        '<div class="card-head"><div class="card-icon">🎖️</div><div><div class="card-title">Grades</div><div class="card-sub">EFFECTIFS</div></div></div>' +
        (gradeListHtml || '<div class="empty-state" style="padding:20px"><div class="empty-title">Aucun agent</div></div>') +
      '</div>' +
      '<div class="card">' +
        '<div class="card-head"><div class="card-icon">⚡</div><div><div class="card-title">Accès rapide</div></div></div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
          quickLink('👮', 'Agents', 'agents') +
          quickLink('📈', 'Statistiques', 'stats') +
          quickLink('🗺️', 'Cartes', 'cartes') +
        '</div>' +
      '</div>' +
    '</div>' +
    renderOrgChart(agents)
  );
}

function renderOrgChart(agents) {
  var gradesSorted = _grades.slice().sort(function(a,b){ return (b.ordre||0)-(a.ordre||0); });
  var maxOrdre = gradesSorted.reduce(function(m,g){ return Math.max(m, g.ordre||0); }, 1);

  function gradeAccent(ordre) {
    var r = ordre / maxOrdre;
    if (r > 0.85) return { solid:'#c9a84c', grad:'linear-gradient(135deg,#c9a84c,#f0d080)', text:'#c9a84c' };
    if (r > 0.65) return { solid:'#9b82c7', grad:'linear-gradient(135deg,#7b5ea7,#b09fd8)', text:'#b09fd8' };
    if (r > 0.45) return { solid:'#4a90c4', grad:'linear-gradient(135deg,#2c6fa6,#5aaee0)', text:'#7ab8d8' };
    if (r > 0.25) return { solid:'#3d8f6e', grad:'linear-gradient(135deg,#2d6e52,#5ab08a)', text:'#6fbf96' };
    return             { solid:'#5a7080', grad:'linear-gradient(135deg,#3a5060,#6a8090)', text:'#8aaabb' };
  }

  var sections = gradesSorted.map(function(g, idx) {
    var members = agents.filter(function(a){ return gradeKey(a.grade) === gradeKey(g.nom) && !isArchivedStatus(a.statut); });
    var ac = gradeAccent(g.ordre||0);

    var header = '<div style="display:flex;align-items:center;gap:10px;margin:' + (idx===0?'4px':'22px') + ' 0 10px 0">' +
      '<div style="width:3px;height:18px;border-radius:2px;background:' + ac.solid + ';flex-shrink:0"></div>' +
      '<span style="font-size:.7rem;font-weight:800;color:' + ac.text + ';letter-spacing:1.4px;text-transform:uppercase">' + esc(gradeLabel(g.nom)) + '</span>' +
      '<div style="flex:1;height:1px;background:linear-gradient(to right,' + ac.solid + '44,transparent)"></div>' +
      '<span style="font-size:.65rem;color:var(--t3);background:var(--bg2);border:1px solid var(--border0);border-radius:20px;padding:1px 8px">' + members.length + ' agent' + (members.length!==1?'s':'') + '</span>' +
    '</div>';

    var cards;
    if (members.length) {
      cards = '<div style="display:flex;flex-wrap:wrap;gap:7px;padding-left:13px">' +
        members.map(function(a) {
          var initials = ((a.prenom||'')[0]||'').toUpperCase() + ((a.nom||'')[0]||'').toUpperCase();
          var statusDot = { 'En service':'#2ecc71','En congé':'#3498db','Suspendu':'#e67e22' }[a.statut] || '#7f8c8d';
          var divBadges = (a.unites||[]).slice(0,3).map(function(u) {
            return '<span style="font-size:.57rem;padding:1px 5px;border-radius:3px;background:rgba(74,144,196,.18);color:#7ab8d8;font-weight:700;letter-spacing:.3px">' + esc(u) + '</span>';
          }).join('');
          return '<div onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})" ' +
            'style="display:flex;align-items:center;gap:10px;background:var(--bg1);border:1px solid var(--border0);border-radius:10px;padding:9px 13px;cursor:pointer;transition:all .18s;min-width:170px;max-width:240px" ' +
            'onmouseover="this.style.borderColor=\'' + ac.solid + '\';this.style.background=\'var(--bg2)\';this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 6px 16px rgba(0,0,0,.35)\'" ' +
            'onmouseout="this.style.borderColor=\'var(--border0)\';this.style.background=\'var(--bg1)\';this.style.transform=\'none\';this.style.boxShadow=\'none\'">' +
            '<div style="width:36px;height:36px;border-radius:50%;background:' + ac.grad + ';display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:900;color:#fff;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.4)">' + esc(initials) + '</div>' +
            '<div style="min-width:0;flex:1">' +
              '<div style="font-size:.83rem;font-weight:700;color:var(--t0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(a.prenom + ' ' + a.nom) + '</div>' +
              '<div style="display:flex;align-items:center;gap:4px;margin-top:3px;flex-wrap:wrap">' +
                '<div style="width:5px;height:5px;border-radius:50%;background:' + statusDot + ';flex-shrink:0"></div>' +
                '<span style="font-size:.64rem;color:var(--t3);font-family:\'Share Tech Mono\',monospace">' + esc(a.matricule) + '</span>' +
                divBadges +
              '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    } else {
      cards = '<div style="padding-left:13px;font-size:.72rem;color:var(--t3);font-style:italic;opacity:.45;padding-bottom:2px">— Vacant —</div>';
    }
    return header + cards;
  }).join('');

  if (!sections) return '';
  return '<div class="card" style="margin-top:18px">' +
    '<div class="card-head"><div class="card-icon">🏛️</div><div><div class="card-title">Organigramme</div><div class="card-sub">HIÉRARCHIE SASP</div></div></div>' +
    sections +
  '</div>';
}

function statCard(icon, label, val, cls) {
  return '<div class="stat-card"><div class="stat-val">' + val + '</div><div class="stat-lbl">' + label + '</div><div class="stat-icon">' + icon + '</div></div>';
}
function quickLink(icon, label, page) {
  return '<button class="btn btn-ghost btn-sm" style="justify-content:flex-start;gap:10px" onclick="navigate(\'' + page + '\')">' + icon + ' ' + label + '</button>';
}

// FAQ
function faqBlock(title, body) {
  return '<div class="card">' +
    '<div class="card-head"><div class="card-icon">?</div><div><div class="card-title">' + esc(title) + '</div></div></div>' +
    '<div class="text-muted" style="line-height:1.7;font-size:.92rem">' + body + '</div>' +
  '</div>';
}

function faqLink(page, label) {
  return '<button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="navigate(\'' + page + '\')">' + esc(label) + '</button>';
}

async function renderFAQ() {
  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div><h1 style="font-size:1.4rem">FAQ SASP Sud</h1><p class="text-muted" style="font-size:.84rem;margin-top:3px">Guide rapide pour utiliser l intranet sans casser les donnees.</p></div>' +
    '</div>' +
    '<div class="faq-grid">' +
      faqBlock('Premiere connexion', '<p>Connectez-vous avec Discord. Le site verifie vos roles sur le Discord SASP Sud. Les roles administrateur donnent acces aux outils de gestion.</p>') +
      faqBlock('Ajouter un agent', '<p>Allez dans <b>Agents</b>, cliquez sur <b>Ajouter un agent</b>, remplissez au minimum prenom, nom, matricule, grade et Discord ID, puis enregistrez.</p>' + faqLink('agents', 'Ouvrir Agents')) +
      faqBlock('Modifier une fiche agent', '<p>Depuis <b>Agents</b>, ouvrez la fiche, puis cliquez sur <b>Modifier</b>. Les changements importants sont envoyes dans le salon logs du Sud.</p>' + faqLink('agents', 'Ouvrir Agents')) +
      faqBlock('Synchroniser Discord vers une fiche', '<p>Sur une fiche agent, le bouton <b>Sync Discord</b> recupere grade, divisions et permissions depuis les roles Discord du membre.</p>') +
      faqBlock('Pointeuse', '<p>Les agents utilisent la page <b>Pointeuse</b> pour prendre ou quitter leur service. L historique permet de suivre les heures par semaine, les primes et les totaux.</p>' + faqLink('pointeuse', 'Ouvrir Pointeuse')) +
      faqBlock('Annuaire', '<p>Quand une fiche agent est creee ou modifiee, l annuaire Discord Sud peut etre mis a jour automatiquement avec les matricules, noms et numeros de telephone.</p>') +
      faqBlock('Grades et divisions', '<p>Les pages <b>Grades</b> et <b>Divisions</b> permettent de consulter la hierarchie, les effectifs et les unites configurees sur le site Sud.</p>' + faqLink('grades', 'Ouvrir Grades') + ' ' + faqLink('units', 'Ouvrir Divisions')) +
      faqBlock('Fugitive Task Force', '<p>La page <b>FTF</b> est partagee entre le SASP Sud et le SASP Nord. Les dossiers crees d un cote apparaissent aussi de l autre avec le service createur.</p>' + faqLink('ftf', 'Ouvrir FTF')) +
      faqBlock('Probleme courant', '<p>Si un agent ne voit pas le site, verifiez qu il a bien un role autorise sur Discord. Si une synchronisation Discord ne fonctionne pas, verifiez le Discord ID de la fiche agent.</p>') +
    '</div>'
  );
}

// ══ AGENTS ════════════════════════════════════════════════════════
async function renderAgents() {
  if (!_grades.length) _grades = await DB.getGrades();
  var agents = await DB.getAgents(_agentFilters);

  var gradeOpts = '<option value="">Tous les grades</option>' +
    _grades.map(function(g){ return '<option value="' + esc(g.nom) + '"' + (_agentFilters.grade===g.nom?' selected':'') + '>' + esc(gradeLabel(g.nom)) + '</option>'; }).join('');
  var uniteOpts = '<option value="">Toutes les divisions</option>' +
    _units.map(function(u){
      return '<option value="' + esc(u.code) + '"' + (_agentFilters.unite===u.code?' selected':'') + '>' + esc(u.code) + ' — ' + esc(u.nom) + '</option>';
    }).join('');

  var rows = agents.length ? agents.map(function(a) {
    var unites = (a.unites||[]).map(function(u){ return unitBadge(u); }).join(' ');
    var ppas = ppaCount(a);
    return '<tr onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})">' +
      '<td class="mono text-gold">' + esc(a.matricule) + '</td>' +
      '<td style="font-weight:600;color:var(--t0)">' + esc(a.prenom) + ' ' + esc(a.nom) + '</td>' +
      '<td>' + gradeBadge(a.grade) + '</td>' +
      '<td>' + (unites||'<span class="text-muted">—</span>') + '</td>' +
      '<td><span class="badge badge-gold" style="font-size:.65rem">PPA ' + ppas + '/3</span></td>' +
      '<td>' + statusBadge(a.statut) + '</td>' +
      '<td onclick="event.stopPropagation()" style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})">Fiche</button>' +
        (canWrite() ? ' <button class="btn btn-outline btn-sm" onclick="openAgentModal(\'' + a.id + '\')">Éditer</button>' : '') +
      '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="7"><div class="empty-state" style="padding:40px"><div class="empty-icon">👮</div><div class="empty-title">Aucun agent trouvé</div></div></td></tr>';

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div><h1 style="font-size:1.4rem">Agents</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">' + agents.length + ' agent(s) trouvé(s)</p></div>' +
      '<div class="flex gap-8">' +
        (canWrite() ? '<button class="btn btn-primary btn-sm" onclick="openAgentModal(null)">+ Ajouter un agent</button>' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="showMatriculesDispos()">🔢 Matricules dispo</button>' +
        (isAdmin() ? '<button class="btn btn-ghost btn-sm" onclick="syncAgentsFromDiscord()">🔄 Sync Discord</button>' : '') +
        (isAdmin() ? '<button class="btn btn-ghost btn-sm" id="syncGradesBtn" onclick="syncGradesFromDiscord(this)">⬇️ Grades Discord</button>' : '') +
        (canWrite() ? '<button class="btn btn-ghost btn-sm" onclick="navigate(\'completude\')">🗂️ Complétude</button>' : '') +
      '</div>' +
    '</div>' +
    '<div class="filter-bar">' +
      '<div class="search-wrap" style="max-width:280px"><span class="search-icon">🔍</span>' +
        '<input class="form-control search-input" placeholder="Nom, prénom, matricule…" value="' + esc(_agentFilters.search) + '" oninput="agentSearch(this.value)"></div>' +
      '<select class="form-control" style="width:auto" onchange="agentFilter(\'grade\',this.value)">' + gradeOpts + '</select>' +
      '<select class="form-control" style="width:auto" onchange="agentFilter(\'unite\',this.value)">' + uniteOpts + '</select>' +
      '<div class="filter-tabs">' +
        ftab('', 'Tous', _agentFilters.statut === '') +
        ftab('En service', 'En service', _agentFilters.statut === 'En service') +
        ftab('En congé', 'En congé', _agentFilters.statut === 'En congé') +
        ftab('Suspendu', 'Suspendus', _agentFilters.statut === 'Suspendu') +
        ftab('Licencié', 'Licenciés', _agentFilters.statut === 'Licencié') +
        ftab('Retraité', 'Retraités', _agentFilters.statut === 'Retraité') +
        ftab('Démission', 'Démission', _agentFilters.statut === 'Démission') +
      '</div>' +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>MATRICULE</th><th>NOM</th><th>GRADE</th><th>UNITÉS</th><th>PPA</th><th>STATUT</th><th>ACTIONS</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
    '</div>'
  );
}

function ftab(val, label, active) {
  return '<button class="ftab' + (active?' active':'') + '" onclick="agentFilter(\'statut\',\'' + val + '\')">' + label + '</button>';
}

var _searchTimer = null;
function agentSearch(v) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function(){ _agentFilters.search = v; renderAgents(); }, 280);
}
function agentFilter(key, val) { _agentFilters[key] = val; renderAgents(); }

// ── Agent modal (add / edit) ──────────────────────────────────────
async function openAgentModal(id) {
  if (!canWrite()) return;
  _grades = await DB.getGrades();
  var ag = id ? await DB.getAgent(id) : null;  var v = ag || {};

  var currentGradeKey = gradeKey(id ? v.grade : (v.grade || 'Rookie'));
  var gradeInList = _grades.some(function(g){ return gradeKey(g.nom) === currentGradeKey; });
  var gradeOpts = (v.grade && !gradeInList ? '<option value="' + esc(v.grade) + '" selected>' + esc(gradeLabel(v.grade)) + '</option>' : '') +
    _grades.map(function(g){
      return '<option value="' + esc(g.nom) + '"' + (currentGradeKey && currentGradeKey===gradeKey(g.nom)?' selected':'') + '>' + esc(gradeLabel(g.nom)) + '</option>';
    }).join('');

  var uniteChecks = _units.filter(function(u){ return u.code !== 'LP'; }).map(function(u){
    var chk = (v.unites||[]).includes(u.code) ? ' checked' : '';
    return '<label class="form-check"><input type="checkbox" name="unite" value="' + esc(u.code) + '"' + chk + '><span class="form-check-lbl">' + esc(u.code) + ' — ' + esc(u.nom) + '</span></label>';
  }).join('');

  openModal({
    eyebrow: id ? 'MODIFIER UN AGENT' : 'NOUVEL AGENT',
    title: id ? (v.prenom + ' ' + v.nom) : 'Ajouter un agent',
    size: 'lg',
    body:
      '<div class="form-grid2">' +
        fld('Prénom *', 'text', 'agPrenom', v.prenom) +
        fld('Nom *', 'text', 'agNom', v.nom) +
      '</div>' +
      '<div class="form-grid2">' +
        fld('Matricule *', 'text', 'agMatricule', v.matricule, '00') +
        fld('Date de naissance', 'date', 'agDob', v.date_naissance) +
      '</div>' +
      '<div class="form-group"><label class="form-label">Téléphone</label><input class="form-control" type="text" id="agTel" value="' + esc(fmtTel(v.telephone)||'') + '" placeholder="(555) 0000" oninput="formatTel(this)" maxlength="11"></div>' +
      fld('IBAN', 'text', 'agIban', v.iban||'', 'Ex : 524156435465413') +
      '<div class="form-grid2">' +
        '<div class="form-group"><label class="form-label">Grade *</label><select class="form-control" id="agGrade">' + gradeOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Statut</label><select class="form-control" id="agStatut">' +
          ['En service','En congé','Suspendu','Licencié','Retraité','Démission'].map(function(s){ return '<option' + (v.statut===s?' selected':'') + '>' + s + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="form-grid2">' +
        fld('Date de recrutement', 'date', 'agRecruit', v.date_recrutement) +
        fld('Date de dernière promotion', 'date', 'agPromo', v.date_promotion) +
      '</div>' +
      '<div class="form-group"><label class="form-label">Unités</label>' +
        '<div class="flex flex-wrap gap-12">' + uniteChecks + '</div>' +
      '</div>' +
      fld('Discord ID', 'text', 'agDiscordId', v.discord_id||'', 'Ex: 123456789012345678') +
      '<div class="form-group"><label class="form-label">Notes</label><textarea class="form-control" id="agNotes" rows="2">' + esc(v.notes||'') + '</textarea></div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveAgent(\'' + (id||'') + '\')">Enregistrer</button>'
  });
}

function formatTel(input) {
  var d = input.value.replace(/\D/g, '').slice(0, 7);
  if (d.length <= 3) input.value = d.length ? '(' + d : '';
  else input.value = '(' + d.slice(0, 3) + ') ' + d.slice(3);
}
function fmtTel(v) {
  if (!v) return null;
  var d = String(v).replace(/\D/g, '').slice(0, 7);
  if (!d) return v;
  return d.length <= 3 ? '(' + d : '(' + d.slice(0, 3) + ') ' + d.slice(3);
}

function fld(label, type, id, val, placeholder) {
  return '<div class="form-group"><label class="form-label">' + label + '</label>' +
    '<input class="form-control" type="' + type + '" id="' + id + '" value="' + esc(val||'') + '"' + (placeholder?' placeholder="' + esc(placeholder) + '"':'') + '></div>';
}

async function saveAgent(id) {
  var prenom = document.getElementById('agPrenom').value.trim();
  var nom    = document.getElementById('agNom').value.trim();
  var mat    = document.getElementById('agMatricule').value.trim();
  if (!prenom || !nom || !mat) { toast('Prénom, nom et matricule sont requis.','error'); return; }
  var discordIdVal = document.getElementById('agDiscordId').value.trim();
  if (!id && !discordIdVal) { toast('Le Discord ID est requis pour créer une fiche.','error'); return; }
  var matTaken = await DB.checkMatricule(mat, id || null);
  if (matTaken) { toast('Ce matricule est déjà utilisé par un autre agent.','error'); return; }

  var oldUnites = []; var oldDiscordId = null; var oldGrade = null;
  if (id) {
    var oldAg = await DB.getAgent(id);
    if (oldAg) { oldUnites = oldAg.unites || []; oldDiscordId = oldAg.discord_id; oldGrade = oldAg.grade; }
  }

  var unites = Array.from(document.querySelectorAll('input[name="unite"]:checked')).map(function(c){ return c.value; });
  var data = {
    prenom: prenom, nom: nom, matricule: mat,
    date_naissance: document.getElementById('agDob').value || null,
    telephone: document.getElementById('agTel').value.trim() || null,
    grade: document.getElementById('agGrade').value,
    statut: document.getElementById('agStatut').value,
    date_recrutement: document.getElementById('agRecruit').value || null,
    date_promotion: document.getElementById('agPromo').value || null,
    unites: unites,
    iban: document.getElementById('agIban').value.trim() || null,
    notes: document.getElementById('agNotes').value.trim() || null,    discord_id: document.getElementById('agDiscordId').value.trim() || null
  };

  try {
    var res;
    if (id) { res = await DB.updateAgent(id, data); }
    else    { res = await DB.createAgent(data); }
    if (res.error) throw res.error;
    closeModal();
    toast(id ? 'Agent modifié.' : 'Agent créé.', 'success');
    if (id) {
      var diffLines = [];
      var old = oldAg || {};
      if ((old.prenom||'') !== data.prenom || (old.nom||'') !== data.nom) diffLines.push('Nom : ' + (old.prenom+' '+old.nom).trim() + ' → ' + data.prenom + ' ' + data.nom);
      if ((old.matricule||'') !== data.matricule) diffLines.push('Matricule : ' + (old.matricule||'—') + ' → ' + data.matricule);
      if ((old.grade||'') !== (data.grade||'')) diffLines.push('Grade : ' + (old.grade||'—') + ' → ' + (data.grade||'—'));
      if ((old.statut||'') !== (data.statut||'')) diffLines.push('Statut : ' + (old.statut||'—') + ' → ' + (data.statut||'—'));
      if ((old.telephone||'') !== (data.telephone||'')) diffLines.push('Téléphone : ' + (old.telephone||'—') + ' → ' + (data.telephone||'—'));
      if (JSON.stringify((old.unites||[]).slice().sort()) !== JSON.stringify((data.unites||[]).slice().sort())) {
        var added   = (data.unites||[]).filter(function(u){ return !(old.unites||[]).includes(u); });
        var removed = (old.unites||[]).filter(function(u){ return !(data.unites||[]).includes(u); });
        if (added.length)   diffLines.push('+Division : ' + added.join(', '));
        if (removed.length) diffLines.push('−Division : ' + removed.join(', '));
      }      if ((old.iban||'') !== (data.iban||'')) diffLines.push('IBAN : ' + (old.iban||'—') + ' → ' + (data.iban||'—'));
      if ((old.notes||'').trim() !== (data.notes||'').trim()) diffLines.push('Notes : modifiées');
      if ((old.date_recrutement||'') !== (data.date_recrutement||'')) diffLines.push('Date recrutement : ' + (old.date_recrutement||'—') + ' → ' + (data.date_recrutement||'—'));
      ['blame1','blame2','blame3'].forEach(function(k,i){
        if (!!old[k] !== !!data[k]) diffLines.push('Blâme ' + (i+1) + ' : ' + (old[k]?'✅':'❌') + ' → ' + (data[k]?'✅':'❌'));
      });
      ['ppa1','ppa2','ppa3'].forEach(function(k,i){
        if (!!old[k] !== !!data[k]) diffLines.push('PPA ' + (i+1) + ' : ' + (old[k]?'✅':'❌') + ' → ' + (data[k]?'✅':'❌'));
      });
      var logFields = [
        { name: 'Agent', value: data.prenom + ' ' + data.nom + ' · ' + data.matricule, inline: true },
        { name: 'Par', value: _whoAmI(), inline: true }
      ];
      if (diffLines.length) logFields.push({ name: 'Modifications', value: diffLines.join('\n').slice(0,1024), inline: false });
      sendLog('✏️ Agent modifié', 0x3498db, logFields);
    } else {
      sendLog('✅ Agent créé', 0x27ae60, [
        { name: 'Agent', value: data.prenom + ' ' + data.nom + ' · ' + data.matricule, inline: true },
        { name: 'Grade', value: data.grade || '—', inline: true },
        { name: 'Divisions', value: (data.unites||[]).join(', ')||'—', inline: true },
        { name: 'Par', value: _whoAmI(), inline: false }
      ]);
    }
    var effectiveDiscordId = data.discord_id || oldDiscordId;
    if (effectiveDiscordId) {
      var addCodes    = unites.filter(function(u){ return TRACKED_DIVISIONS.includes(u) && !oldUnites.includes(u); });
      var removeCodes = oldUnites.filter(function(u){ return TRACKED_DIVISIONS.includes(u) && !unites.includes(u); });
      if (data.grade && data.grade !== oldGrade) {
        if (data.grade) addCodes.push(data.grade);
        if (oldGrade)   removeCodes.push(oldGrade);
      }
      if (addCodes.length || removeCodes.length) syncDiscordRoles(effectiveDiscordId, addCodes, removeCodes);
    }
    refreshAgentList();
    if (id && S.page === 'agent-profile') await renderAgentProfile();
    else await renderAgents();
  } catch(err) {
    toast(err.message || 'Erreur lors de la sauvegarde.', 'error');
  }
}

// ══ AGENT PROFILE ══════════════════════════════════════════════════
async function renderAgentProfile() {
  var id = S.pd.id;
  if (!id) { navigate('agents'); return; }
  var [ag, armes] = await Promise.all([
    DB.getAgent(id),
    DB.getAgentArmes(id)
  ]);  if (!ag) { navigate('agents'); return; }

  var unites = (ag.unites||[]).map(unitBadge).join(' ');
  var ppas = [
    { key:'ppa1', label:'PPA 1', val:ag.ppa1, date:ag.ppa1_date },
    { key:'ppa2', label:'PPA 2', val:ag.ppa2, date:ag.ppa2_date },
    { key:'ppa3', label:'PPA 3', val:ag.ppa3, date:ag.ppa3_date }
  ];
  var agUnites = ag.unites || [];

  var ppaHtml = ppas.map(function(p){
      return '<div class="ppa-item' + (p.val?' checked':'') + '">' +
        '<div class="ppa-check">' + (p.val ? '✅' : '⬜') + '</div>' +
        '<div>' +
          '<div class="ppa-label">' + p.label + '</div>' +
          (p.val && p.date ? '<div style="font-size:.7rem;color:var(--t3);font-family:\'Share Tech Mono\',monospace">Obtenu le ' + fmt(p.date) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');

  var qualHtml = _units.map(function(u){
    var active = agUnites.includes(u.code);
    return '<span class="qual-badge qual-' + u.code + (active?' earned':'') + '">' + u.code + '</span>';
  }).join('');

  setContent(
    '<button class="btn btn-ghost btn-sm mb-14" onclick="navigate(\'agents\')">← Retour</button>' +

    '<div class="profile-hd">' +
      '<div class="profile-av">👤</div>' +
      '<div style="flex:1">' +
        '<h1 class="profile-name">' + esc(ag.prenom) + ' ' + esc(ag.nom) + '</h1>' +
        '<div class="profile-mat">' + esc(ag.matricule) + '</div>' +
        '<div class="profile-meta">' + gradeBadge(ag.grade) + statusBadge(ag.statut) + unites + '</div>' +
      '</div>' +
      (ag.statut === 'Archivé' ?
        '<div class="profile-actions"><span class="badge badge-red" style="font-size:.8rem;padding:6px 14px">🗃️ Archivé — lecture seule</span></div>' :
        canWrite() ?
          '<div class="profile-actions">' +
            '<button class="btn btn-outline btn-sm" onclick="openAgentModal(\'' + id + '\')">✏️ Modifier</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="syncDiscordToAgent(\'' + id + '\')" title="Sync divisions depuis Discord">🔄 Sync Discord</button>' +
            (isAdmin() ? '<button class="btn btn-danger btn-sm" onclick="deleteAgentDirect(\'' + id + '\')">Supprimer</button>' : '') +
          '</div>' : '') +
    '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">' +
      '<div style="display:contents">' +

        '<div class="card">' +
          '<div class="card-head"><div class="card-icon">👤</div><div><div class="card-title">Informations' + '</div></div></div>' +
          infoRow('Date de naissance', fmt(ag.date_naissance)) +
          infoRow('Téléphone', fmtTel(ag.telephone)) +
          infoRow('Date de recrutement', fmt(ag.date_recrutement)) +
          infoRow('Dernière promotion', fmt(ag.date_promotion)) +
          (ag.iban ? infoRow('IBAN', ag.iban) : '') +        '</div>' +

        '<div class="card">' +
          '<div class="flex-between mb-10">' +
            '<div class="card-head" style="margin:0"><div class="card-icon">📝</div><div><div class="card-title">Notes internes</div></div></div>' +
            (canWrite() && ag.statut !== 'Archivé' ? '<button class="btn btn-ghost btn-sm" onclick="openNotesModal(\'' + id + '\')">' + (ag.notes ? '✏️' : '+ Ajouter') + '</button>' : '') +
          '</div>' +
          (ag.notes ? '<div style="font-size:.84rem;color:var(--t1);white-space:pre-wrap;line-height:1.5">' + esc(ag.notes) + '</div>' : '<div style="font-size:.82rem;color:var(--t3)">Aucune note.</div>') +
        '</div>' +

        '<div class="card">' +
          '<div class="flex-between mb-10">' +
            '<div class="card-head" style="margin:0"><div class="card-icon">📚</div><div><div class="card-title">Formations PPA</div></div></div>' +
            (isAdmin() && ag.statut !== 'Archivé' ? '<button class="btn btn-ghost btn-sm" onclick="openPPAModal(\'' + id + '\')">✏️ PPA</button>' : '') +
          '</div>' +
          '<div class="ppa-grid">' + ppaHtml + '</div>' +
          (function(){
            var b = [ag.blame1,ag.blame2,ag.blame3];
            return '<div style="margin-top:14px;border-top:1px solid var(--border0);padding-top:12px">' +
              '<div class="flex-between" style="margin-bottom:8px">' +
                '<div style="font-size:.72rem;color:var(--red);font-weight:700;letter-spacing:.8px">⚠️ BLÂMES</div>' +
                (isAdmin() && ag.statut !== 'Archivé' ? '<button class="btn btn-ghost btn-sm" style="font-size:.72rem;padding:2px 8px" onclick="openBlameModal(\'' + id + '\')">✏️ Blâmes</button>' : '') +
              '</div>' +
              '<div style="display:flex;gap:8px">' +
                [1,2,3].map(function(n){
                  var active = b[n-1];
                  return '<span style="padding:4px 14px;border-radius:20px;font-size:.78rem;font-weight:600;border:1px solid;' +
                    (active ? 'background:rgba(231,76,60,.18);color:var(--red);border-color:rgba(231,76,60,.5)' :
                              'background:var(--bg2);color:var(--t3);border-color:var(--border0)') +
                    '">Blâme ' + n + '</span>';
                }).join('') +
              '</div>' +
            '</div>';
          })()+
        '</div>' +

        '<div class="card">' +
          '<div class="card-head"><div class="card-icon">🏅</div><div><div class="card-title">Divisions</div></div></div>' +
          '<div class="qual-grid">' + qualHtml + '</div>' +
          '<div style="margin-top:14px;border-top:1px solid var(--border0);padding-top:12px">' +
            '<div class="flex-between" style="margin-bottom:8px">' +
              '<div style="font-size:.72rem;color:var(--blue);font-weight:700;letter-spacing:.8px">📋 FORMATIONS</div>' +
              (isAdmin() && ag.statut !== 'Archivé' ? '<button class="btn btn-ghost btn-sm" style="font-size:.72rem;padding:2px 8px" onclick="openFormationsModal(\'' + id + '\')">✏️ Formations</button>' : '') +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              (function(){
                var fmts = [
                  { key:'formation_lead', label:'Lead Terrain' },
                  { key:'formation_nego', label:'Négociation' },
                  { key:'lp', label:'Lincoln Patrol' }
                ];
                return fmts.map(function(f){
                  var active = f.key === 'lp' ? (ag.unites||[]).includes('LP') : ag[f.key];
                  return '<span style="padding:4px 14px;border-radius:20px;font-size:.78rem;font-weight:600;border:1px solid;' +
                    (active ? 'background:rgba(59,130,246,.18);color:var(--blue);border-color:rgba(59,130,246,.5)' :
                              'background:var(--bg2);color:var(--t3);border-color:var(--border0)') +
                    '">' + f.label + '</span>';
                }).join('');
              })() +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="flex-between mb-10">' +
            '<div class="card-head" style="margin:0"><div class="card-icon">🔫</div><div><div class="card-title">Armement</div></div></div>' +
            (canWrite() && ag.statut !== 'Archivé' ? '<button class="btn btn-outline btn-sm" onclick="openAddArmeModal(\'' + id + '\')">+ Ajouter</button>' : '') +
          '</div>' +
          (function() {
            var html = '';
            function armeRow(a) {
              return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:var(--bg1);border-radius:var(--rSm);margin-bottom:4px">' +
                '<div>' +
                  '<div style="font-size:.85rem;font-weight:600;color:var(--t0)">' + esc(a.nom) + '</div>' +
                  '<div style="font-size:.7rem;color:var(--t3);font-family:\'Share Tech Mono\',monospace">' + (a.serie ? 'S/N : ' + esc(a.serie) : 'Pas de numéro de série') + '</div>' +
                '</div>' +
                (canWrite() ? '<button class="btn btn-danger btn-sm btn-icon" onclick="delArme(\'' + a.id + '\',\'' + id + '\')">✕</button>' : '') +
              '</div>';
            }
            var lvl0 = armes.filter(function(a){ return a.ppa_niveau === 0 || a.ppa_niveau === null; });
            if (lvl0.length) {
              html += '<div style="margin-bottom:10px"><div style="font-size:.68rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">Sans PPA</div>' +
                lvl0.map(armeRow).join('') + '</div>';
            }
            [1,2,3].forEach(function(n) {
              var lvl = armes.filter(function(a){ return a.ppa_niveau === n; });
              if (!ag['ppa'+n] && !lvl.length) return;
              html += '<div style="margin-bottom:10px">' +
                '<div style="font-size:.68rem;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">PPA ' + n + '</div>';
              if (lvl.length) {
                html += lvl.map(armeRow).join('');
              } else {
                html += '<div style="font-size:.8rem;color:var(--t3);padding:4px 0">Aucune arme assignée</div>';
              }
              html += '</div>';
            });
            if (!html) html = '<div style="font-size:.82rem;color:var(--t3)">Aucun PPA — aucune arme assignable.</div>';
            return html;
          })() +
        '</div>' +

      '</div>' +
    '</div>'
  );
}

function infoRow(label, val) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border0)">' +
    '<span style="font-size:.78rem;color:var(--t3)">' + esc(label) + '</span>' +
    '<span style="font-size:.86rem;color:var(--t0)">' + esc(val||'—') + '</span>' +
  '</div>';
}

async function openHistModal(agentId) {
  openModal({
    eyebrow: 'HISTORIQUE AGENT',
    title: 'Ajouter un événement',
    body:
      '<div class="form-group"><label class="form-label">Type</label><select class="form-control" id="histType">' +
        ['promotion','sanction','recompense','note'].map(function(t){
          return '<option value="' + t + '">' + {promotion:'Promotion',sanction:'Sanction',recompense:'Récompense',note:'Note admin'}[t] + '</option>';
        }).join('') +
      '</select></div>' +
      fld('Titre *', 'text', 'histTitre', '', 'Ex: Promotion Deputy II') +
      fld('Date', 'date', 'histDate', new Date().toISOString().split('T')[0]) +
      '<div class="form-group"><label class="form-label">Description</label><textarea class="form-control" id="histDesc" rows="2"></textarea></div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveHistory(\'' + agentId + '\')">Enregistrer</button>'
  });
}

async function saveHistory(agentId) {
  var titre = document.getElementById('histTitre').value.trim();
  if (!titre) { toast('Le titre est requis.','error'); return; }
  var data = {
    agent_id: agentId,
    type: document.getElementById('histType').value,
    titre: titre,
    date: document.getElementById('histDate').value || new Date().toISOString().split('T')[0],
    description: document.getElementById('histDesc').value.trim() || null
  };
  try {
    var r = await DB.addHistory(data);
    if (r.error) throw r.error;
    closeModal();
    toast('Événement ajouté.','success');
    await renderAgentProfile();
  } catch(e) { toast(e.message,'error'); }
}

async function delHistory(hId, agentId) {
  if (!confirm('Supprimer cet événement ?')) return;
  await DB.deleteHistory(hId);
  toast('Supprimé.','info');
  await renderAgentProfile();
}

async function openPPAModal(agentId) {
  var ag = await DB.getAgent(agentId);
  if (!ag) return;
  openModal({
    eyebrow: 'FORMATIONS & QUALIFICATIONS',
    title: ag.prenom + ' ' + ag.nom,
    body:
      '<div class="form-group"><label class="form-label">Formations PPA</label>' +
        '<div style="display:flex;flex-direction:column;gap:10px">' +
          ppaCheck('qkPA','SASP Academy (PA)',ag.qual_pa) +
          '<div style="height:1px;background:var(--border0);margin:2px 0"></div>' +
          ppaCheckDate('ppaCk1','PPA 1',ag.ppa1,ag.ppa1_date,'ppaDate1') +
          ppaCheckDate('ppaCk2','PPA 2',ag.ppa2,ag.ppa2_date,'ppaDate2') +
          ppaCheckDate('ppaCk3','PPA 3',ag.ppa3,ag.ppa3_date,'ppaDate3') +
        '</div>' +
      '</div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="savePPAModal(\'' + agentId + '\')">Enregistrer</button>'
  });
}

function ppaCheck(id, label, checked) {
  return '<label class="form-check"><input type="checkbox" id="' + id + '"' + (checked?' checked':'') + '><span class="form-check-lbl">' + label + '</span></label>';
}

function ppaCheckDate(ckId, label, checked, date, dateId) {
  return '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<label class="form-check" style="margin:0;min-width:90px"><input type="checkbox" id="' + ckId + '"' + (checked?' checked':'') + ' onchange="if(!this.checked){document.getElementById(\'' + dateId + '\').value=\'\'}">' +
      '<span class="form-check-lbl">' + label + '</span></label>' +
    '<div style="display:flex;align-items:center;gap:6px">' +
      '<span style="font-size:.75rem;color:var(--t3)">Obtenu le</span>' +
      '<input type="date" class="form-control" id="' + dateId + '" value="' + esc(date||'') + '" style="width:155px;padding:5px 8px">' +
    '</div>' +
  '</div>';
}

async function savePPAModal(agentId) {
  var old = await DB.getAgent(agentId);
  var data = {
    ppa1: document.getElementById('ppaCk1').checked,
    ppa2: document.getElementById('ppaCk2').checked,
    ppa3: document.getElementById('ppaCk3').checked,
    ppa1_date: document.getElementById('ppaCk1').checked ? (document.getElementById('ppaDate1').value || null) : null,
    ppa2_date: document.getElementById('ppaCk2').checked ? (document.getElementById('ppaDate2').value || null) : null,
    ppa3_date: document.getElementById('ppaCk3').checked ? (document.getElementById('ppaDate3').value || null) : null,
    qual_pa: document.getElementById('qkPA').checked
  };
  try {
    var r = await DB.updateAgent(agentId, data);
    if (r.error) throw r.error;
    if (old && old.discord_id) {
      var addCodes = [], removeCodes = [];
      if (!!data.ppa1 !== !!old.ppa1) (data.ppa1 ? addCodes : removeCodes).push('ppa1');
      if (!!data.ppa2 !== !!old.ppa2) (data.ppa2 ? addCodes : removeCodes).push('ppa2');
      if (!!data.ppa3 !== !!old.ppa3) {
        if (data.ppa3) { addCodes.push('ppa3a'); addCodes.push('ppa3b'); }
        else { removeCodes.push('ppa3a'); removeCodes.push('ppa3b'); }
      }
      if (addCodes.length || removeCodes.length) syncDiscordRoles(old.discord_id, addCodes, removeCodes);
    }
    if (old && old.discord_id && (addCodes.length || removeCodes.length)) {
      var ppaLabels = { ppa1:'PPA 1 (Glock)', ppa2:'PPA 2 (MP5)', ppa3a:'PPA 3 Fusil à pompe', ppa3b:'PPA 3 Fusil carabine' };
      var fields = [{ name: 'Agent', value: esc(old.prenom) + ' ' + esc(old.nom) + ' (' + esc(old.matricule) + ')', inline: false }];
      if (addCodes.length) fields.push({ name: '✅ Ajouté', value: addCodes.map(function(c){ return ppaLabels[c]||c; }).join(', '), inline: true });
      if (removeCodes.length) fields.push({ name: '❌ Retiré', value: removeCodes.map(function(c){ return ppaLabels[c]||c; }).join(', '), inline: true });
      fields.push({ name: 'Par', value: _whoAmI(), inline: true });
      sendLog('🔫 Mise à jour PPA', 0xe67e22, fields);
    }
    closeModal();
    toast('Formations mises à jour.','success');
    await renderAgentProfile();
  } catch(e) { toast(e.message,'error'); }
}

async function openFormationsModal(agentId) {
  var ag = await DB.getAgent(agentId);
  if (!ag) return;
  openModal({
    eyebrow: 'DIVISIONS — FORMATIONS',
    title: ag.prenom + ' ' + ag.nom,
    body:
      '<div class="form-group"><label class="form-label" style="color:var(--blue)">📋 Formations spécialisées</label>' +
        '<div style="display:flex;flex-direction:column;gap:10px">' +
          ppaCheck('fmtLead','Lead Terrain',ag.formation_lead) +
          ppaCheck('fmtNego','Négociation',ag.formation_nego) +
          ppaCheck('fmtLP','Lincoln Patrol',(ag.unites||[]).includes('LP')) +
        '</div>' +
      '</div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveFormationsModal(\'' + agentId + '\')">Enregistrer</button>'
  });
}
async function saveFormationsModal(agentId) {
  var ag = await DB.getAgent(agentId);
  var lpChecked = document.getElementById('fmtLP').checked;
  var currentUnites = (ag ? ag.unites || [] : []).filter(function(u){ return u !== 'LP'; });
  if (lpChecked) currentUnites.push('LP');
  var data = {
    formation_lead: document.getElementById('fmtLead').checked,
    formation_nego: document.getElementById('fmtNego').checked,
    unites: currentUnites
  };
  try {
    var r = await DB.updateAgent(agentId, data);
    if (r.error) throw r.error;
    if (ag && ag.discord_id) {
      if (lpChecked) syncDiscordRoles(ag.discord_id, ['LP'], []);
      else syncDiscordRoles(ag.discord_id, [], ['LP']);
    }
    closeModal();
    toast('Formations mises à jour.', 'success');
    await renderAgentProfile();
  } catch(e) { toast(e.message, 'error'); }
}

async function openBlameModal(agentId) {
  var ag = await DB.getAgent(agentId);
  if (!ag) return;
  openModal({
    eyebrow: 'SANCTIONS',
    title: ag.prenom + ' ' + ag.nom,
    body:
      '<div class="form-group"><label class="form-label" style="color:var(--red)">⚠️ Blâmes</label>' +
        '<div style="display:flex;flex-direction:column;gap:10px">' +
          ppaCheck('blameCk1','Blâme 1',ag.blame1) +
          ppaCheck('blameCk2','Blâme 2',ag.blame2) +
          ppaCheck('blameCk3','Blâme 3',ag.blame3) +
        '</div>' +
      '</div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveBlameModal(\'' + agentId + '\')">Enregistrer</button>'
  });
}
async function saveBlameModal(agentId) {
  var data = {
    blame1: document.getElementById('blameCk1').checked,
    blame2: document.getElementById('blameCk2').checked,
    blame3: document.getElementById('blameCk3').checked
  };
  try {
    var r = await DB.updateAgent(agentId, data);
    if (r.error) throw r.error;
    closeModal();
    toast('Blâmes mis à jour.', 'success');
    await renderAgentProfile();
  } catch(e) { toast(e.message, 'error'); }
}

async function openAddArmeModal(agentId) {
  if (!canWrite()) return;
  var ag = await DB.getAgent(agentId);
  if (!ag) return;
  var ppas = [{ level:0, label:'Sans PPA (Taser / Been Bag)' }];
  if (ag.ppa1) ppas.push({ level:1, label:'PPA 1' });
  if (ag.ppa2) ppas.push({ level:2, label:'PPA 2' });
  if (ag.ppa3) ppas.push({ level:3, label:'PPA 3' });
  var ppaOpts = ppas.map(function(p){ return '<option value="' + p.level + '">' + p.label + '</option>'; }).join('');
  openModal({
    eyebrow: 'ARMEMENT',
    title: 'Ajouter une arme — ' + esc(ag.prenom) + ' ' + esc(ag.nom),
    body:
      '<div class="form-group"><label class="form-label">Arme rapide</label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
          ['Taser','Been Bag','Glock','MP5','Fusil à pompe','Fusil carabine'].map(function(w){
            var isNoPpa = w === 'Taser' || w === 'Been Bag';
            return '<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById(\'armeNom\').value=\'' + w + '\';' + (isNoPpa ? 'document.getElementById(\'armeNiveau\').value=\'0\'' : '') + '">' + w + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      fld("Nom de l'arme *", 'text', 'armeNom', '', 'Ex : Glock 17, AR-15…') +
      fld('Numéro de série', 'text', 'armeSerie', '', 'Ex : GK-123456') +
      '<div class="form-group"><label class="form-label">Niveau PPA requis *</label>' +
        '<select class="form-control" id="armeNiveau">' + ppaOpts + '</select>' +
      '</div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveArme(\'' + agentId + '\')">Ajouter</button>'
  });
}

async function saveArme(agentId) {
  var nom = document.getElementById('armeNom').value.trim();
  if (!nom) { toast('Nom de l\'arme requis.','error'); return; }
  var serie  = document.getElementById('armeSerie').value.trim();
  var niveau = parseInt(document.getElementById('armeNiveau').value, 10);
  try {
    var r = await DB.addAgentArme({ agent_id: agentId, nom: nom, serie: serie||null, ppa_niveau: niveau });
    if (r.error) throw r.error;
    closeModal();
    toast('Arme ajoutée.','success');
    await renderAgentProfile();
  } catch(e) { toast(e.message,'error'); }
}

async function delArme(armeId, agentId) {
  if (!confirm('Retirer cette arme ?')) return;
  await DB.deleteAgentArme(armeId);
  toast('Arme retirée.','info');
  await renderAgentProfile();
}

// ══ GRADES ═════════════════════════════════════════════════════════
async function renderGrades() {
  _grades = await DB.getGrades();
  var agents = visibleRosterAgents(await DB.getAgents());

  var gradeCounts = await getDashboardGradeCounts(_grades, agents, 'grades');

  var rows = _grades.length ? _grades.map(function(g, i){
    return '<tr>' +
      '<td class="mono text-gold" style="width:40px">' + (i+1) + '</td>' +
      '<td style="font-weight:600;color:var(--t0)">' + esc(gradeLabel(g.nom)) + '</td>' +
      '<td class="mono">' + esc(g.abrev||'—') + '</td>' +
      '<td>' + (gradeCounts[gradeKey(g.nom)]||0) + ' agent(s)</td>' +
      (isAdmin() ?
        '<td onclick="event.stopPropagation()" style="white-space:nowrap">' +
          '<button class="btn btn-ghost btn-sm" onclick="openGradeModal(\'' + g.id + '\')">✏️</button>' +
          ' <button class="btn btn-danger btn-sm" onclick="deleteGrade(\'' + g.id + '\',\'' + esc(g.nom) + '\')">✕</button>' +
        '</td>' : '') +
    '</tr>';
  }).join('') : '<tr><td colspan="5"><div class="empty-state" style="padding:30px"><div class="empty-icon">🎖️</div><div class="empty-title">Aucun grade</div></div></td></tr>';

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div><h1 style="font-size:1.4rem">Grades</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Hiérarchie de la SASP — du plus haut au plus bas</p></div>' +
      (isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="openGradeModal(null)">+ Ajouter un grade</button>' : '') +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden"><div class="table-wrap"><table>' +
      '<thead><tr><th>#</th><th>NOM</th><th>ABRÉVIATION</th><th>EFFECTIF</th>' + (isAdmin() ? '<th>ACTIONS</th>' : '') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div></div>'
  );
}

function openGradeModal(id) {
  var g = id ? _grades.find(function(x){ return x.id==id; }) : null;
  var v = g || {};
  openModal({
    eyebrow: id ? 'MODIFIER UN GRADE' : 'NOUVEAU GRADE',
    title: id ? v.nom : 'Ajouter un grade',
    size: 'sm',
    body:
      fld('Nom du grade *', 'text', 'gNom', v.nom, 'Ex: Deputy I') +
      '<div class="form-grid2">' +
        fld('Abréviation', 'text', 'gAbrev', v.abrev, 'Ex: DEP I') +
        fld('Ordre hiérarchique *', 'number', 'gOrdre', v.ordre, '1') +
      '</div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveGrade(\'' + (id||'') + '\')">Enregistrer</button>'
  });
}

async function saveGrade(id) {
  var nom = document.getElementById('gNom').value.trim();
  if (!nom) { toast('Le nom est requis.','error'); return; }
  var data = { nom: nom, abrev: document.getElementById('gAbrev').value.trim()||null, ordre: parseInt(document.getElementById('gOrdre').value)||(_grades.length+1) };
  try {
    var r = id ? await DB.updateGrade(id, data) : await DB.createGrade(data);
    if (r.error) throw r.error;
    closeModal(); toast('Grade enregistré.','success'); _grades = await DB.getGrades(); await renderGrades();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteGrade(id, nom) {
  if (!confirm('Supprimer le grade "' + nom + '" ?')) return;
  var r = await DB.deleteGrade(id);
  if (r.error) { toast(r.error.message,'error'); return; }
  toast('Grade supprimé.','info'); _grades = await DB.getGrades(); await renderGrades();
}

// ══ DIVISIONS ══════════════════════════════════════════════════════
async function renderUnits() {
  var [units, agents] = await Promise.all([DB.getUnits(), DB.getAgents()]);

  var html = units.map(function(u) {
    var members = agents.filter(function(a){ return (a.unites||[]).includes(u.code); });
    var colors = { PA:'blue', CID:'orange', SWAT:'red', TU:'green', PRD:'gold', FTF:'gold' };
    var cls = 'badge-' + (colors[u.code]||'gray');
    return '<div class="card">' +
      '<div class="card-head">' +
        '<div class="card-icon"><span class="badge ' + cls + '" style="font-size:.9rem;padding:4px 10px">' + esc(u.code) + '</span></div>' +
        '<div style="flex:1"><div class="card-title">' + esc(u.nom) + '</div><div class="card-sub">' + members.length + ' MEMBRE(S)</div></div>' +
        (isAdmin() ? '<button class="btn btn-ghost btn-sm" onclick="openUnitModal(\'' + u.id + '\')">✏️</button> <button class="btn btn-danger btn-sm" onclick="deleteUnit(\'' + u.id + '\',\'' + esc(u.nom) + '\')">✕</button>' : '') +
      '</div>' +
      '<p style="font-size:.84rem;color:var(--t2);margin-bottom:14px">' + esc(u.description||'—') + '</p>' +
      '<div class="divider"></div>' +
      '<div style="font-size:.76rem;color:var(--t3);font-family:\'Share Tech Mono\',monospace;margin-bottom:8px">CONDITIONS D\'ACCÈS</div>' +
      '<p style="font-size:.82rem;color:var(--t2)">' + esc(u.conditions_acces||'—') + '</p>' +
      (members.length ? '<div class="divider"></div><div style="font-size:.76rem;color:var(--t3);font-family:\'Share Tech Mono\',monospace;margin-bottom:8px">MEMBRES</div><div style="display:flex;flex-wrap:wrap;gap:6px">' +
        members.map(function(a){ return '<span class="badge badge-gray" style="cursor:pointer" onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})">' + esc(a.prenom+' '+a.nom) + '</span>'; }).join('') + '</div>' : '') +
    '</div>';
  }).join('');

  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Divisions</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Divisions spécialisées de la SASP</p></div>' +
    (isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="openUnitModal(null)">+ Ajouter une division</button>' : '') +
    '</div>' +
    '<div class="page-grid2">' + html + '</div>'
  );
}

function openUnitModal(id) {
  var isNew = !id;
  openModal({
    eyebrow: isNew ? 'NOUVELLE DIVISION' : 'MODIFIER LA DIVISION',
    title: isNew ? 'Ajouter une division' : 'Configuration de la division',
    size: 'sm',
    body:
      (isNew ? '<div class="form-grid2">' + fld('Code *', 'text', 'uCode', '', 'Ex: CID') + fld('Nom *', 'text', 'uNom', '', 'Ex: Criminal Investigation Div.') + '</div>' : '') +
      fld('Description', 'text', 'uDesc', '') +
      '<div class="form-group"><label class="form-label">Conditions d\'accès</label><textarea class="form-control" id="uCond" rows="3"></textarea></div>',
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveUnit(\'' + (id||'') + '\')">Enregistrer</button>'
  });
  if (!isNew) {
    DB.getUnits().then(function(units) {
      var u = units.find(function(x){ return x.id==id; });
      if (u) {
        document.getElementById('uDesc').value = u.description||'';
        document.getElementById('uCond').value = u.conditions_acces||'';
      }
    });
  }
}

async function saveUnit(id) {
  var isNew = !id;
  var data = {
    description: document.getElementById('uDesc').value.trim()||null,
    conditions_acces: document.getElementById('uCond').value.trim()||null
  };
  if (isNew) {
    var code = document.getElementById('uCode').value.trim().toUpperCase();
    var nom  = document.getElementById('uNom').value.trim();
    if (!code || !nom) { toast('Code et nom requis.','error'); return; }
    data.code = code; data.nom = nom;
  }
  try {
    var r = isNew ? await DB.createUnit(data) : await DB.updateUnit(id, data);
    if (r.error) throw r.error;
    _units = await DB.getUnits();
    closeModal(); toast(isNew ? 'Division créée.' : 'Division mise à jour.','success'); await renderUnits();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteUnit(id, nom) {
  if (!confirm('Supprimer la division "' + nom + '" ?')) return;
  var r = await DB.deleteUnit(id);
  if (r.error) { toast(r.error.message,'error'); return; }
  _units = await DB.getUnits();
  toast('Division supprimée.','info'); await renderUnits();
}

// ══ MDT ════════════════════════════════════════════════════════════
var _mdtPages = [];

async function renderMDT() {
  _mdtPages = await DB.getAllMdtPages();
  _mdtSelPage = null;

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div><h1 style="font-size:1.4rem">Guide MDT</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Documentation interne de la SASP</p></div>' +
      (canWrite() ? '<button class="btn btn-primary btn-sm" onclick="openMdtNewPage()">+ Nouvelle page</button>' : '') +
    '</div>' +
    '<div class="mdt-layout">' +
      '<aside class="mdt-sidebar"><div id="mdtList"></div></aside>' +
      '<div class="mdt-main" id="mdtMain">' +
        '<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">Sélectionnez une page</div></div>' +
      '</div>' +
    '</div>'
  );
  renderMdtList();
}

function movePageBtns(id, idx, total, ctx) {
  if (!canWrite()) return '';
  return '<div style="display:flex;gap:1px;margin-left:auto;opacity:.5" onclick="event.stopPropagation()">' +
    (idx > 0 ? '<button class="btn-move" onclick="movePage(\'' + id + '\',\'up\',\'' + ctx + '\')">▲</button>' : '<span style="width:16px"></span>') +
    (idx < total-1 ? '<button class="btn-move" onclick="movePage(\'' + id + '\',\'down\',\'' + ctx + '\')">▼</button>' : '<span style="width:16px"></span>') +
  '</div>';
}
async function movePage(pageId, dir, ctx) {
  var pages, reload;
  if (ctx === 'mdt') {
    pages = _mdtPages;
    reload = async function(){ _mdtPages = await DB.getAllMdtPages(); renderMdtList(); };
  } else if (ctx === 'vehicle') {
    pages = _vehiclePages;
    reload = async function(){ _vehiclePages = await DB.getAllVehiclePages(_vehicleCatId); renderVehicleList(); };
  } else {
    pages = _wikiPages[_wikiSlug] || [];
    reload = (function(slug){ return async function(){ _wikiPages[slug] = await DB.getAllVehiclePages(_wikiCats[slug]); renderWikiList(slug); }; })(_wikiSlug);
  }
  var idx = -1;
  for (var i = 0; i < pages.length; i++) { if (pages[i].id === pageId) { idx = i; break; } }
  if (idx === -1) return;
  var swapIdx = dir === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= pages.length) return;
  await Promise.all([
    DB.updateMdtPage(pages[idx].id, { ordre: swapIdx }),
    DB.updateMdtPage(pages[swapIdx].id, { ordre: idx })
  ]);
  await reload();
}
function renderMdtList() {
  var el = document.getElementById('mdtList');
  if (!el) return;
  if (!_mdtPages.length) {
    el.innerHTML = '<p style="color:var(--t3);font-size:.8rem;text-align:center;padding:20px 8px">Aucune page.' +
      (canWrite() ? '<br>Cliquez sur "+ Nouvelle page".' : '') + '</p>';
    return;
  }
  el.innerHTML = _mdtPages.map(function(p, i) {
    return '<div class="mdt-page-item' + (_mdtSelPage===p.id?' active':'') + '" onclick="openMdtPage(\'' + p.id + '\')" style="justify-content:space-between">' +
      '<span>📄 ' + esc(p.titre) + '</span>' + movePageBtns(p.id, i, _mdtPages.length, 'mdt') + '</div>';
  }).join('');
}

async function openMdtPage(pageId) {
  _mdtSelPage = pageId;
  renderMdtList();
  var page = await DB.getMdtPage(pageId);
  if (!page) return;
  var main = document.getElementById('mdtMain');
  if (!main) return;
  main.innerHTML =
    '<div class="card mb-14">' +
      '<div class="flex-between flex-wrap gap-8">' +
        '<div><h2 style="font-size:1.3rem">' + esc(page.titre) + '</h2>' +
        '<div class="mono" style="font-size:.64rem;color:var(--t3);margin-top:3px">Modifié le ' + fmt(page.updated_at) + '</div></div>' +
        (canWrite() ? '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-outline btn-sm" onclick="editMdtPage(\'' + pageId + '\')">✏️ Modifier</button>' +
          '<button class="btn btn-danger btn-sm" onclick="delMdtPage(\'' + pageId + '\')">Supprimer</button>' +
        '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="card ql-view" style="min-height:300px;font-size:.9rem;line-height:1.7;color:var(--t1)">' +
      (page.contenu || '<p class="text-muted">Page vide. Cliquez sur "Modifier" pour ajouter du contenu.</p>') +
    '</div>';
}

async function editMdtPage(pageId) {
  var page = await DB.getMdtPage(pageId);
  if (!page) return;
  var main = document.getElementById('mdtMain');
  main.innerHTML =
    '<div class="card mb-14">' +
      '<div class="flex-between flex-wrap gap-8">' +
        '<input class="form-control" id="mdtEditTitle" value="' + esc(page.titre) + '" style="font-size:1.1rem;font-weight:700;max-width:400px">' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-ghost btn-sm" onclick="openMdtPage(\'' + pageId + '\')">Annuler</button>' +
          '<button class="btn btn-primary btn-sm" onclick="saveMdtPage(\'' + pageId + '\')">💾 Sauvegarder</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="mdtEditor"></div>';

  _quill = new Quill('#mdtEditor', {
    theme: 'snow',
    modules: {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'link', 'image'],
          [{ color: [] }, { align: [] }]
        ],
        handlers: {
          image: function() {
            openModal({
              eyebrow: 'INSÉRER UNE IMAGE',
              title: 'URL de l\'image',
              size: 'sm',
              body: fld('Lien direct *', 'url', 'imgUrl', '', 'https://i.imgur.com/...'),
              footer: '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button class="btn btn-primary" onclick="insertMdtImage()">Insérer</button>'
            });
          }
        }
      }
    }
  });
  if (page.contenu) _quill.clipboard.dangerouslyPasteHTML(0, page.contenu);
}

async function saveMdtPage(pageId) {
  var titre = document.getElementById('mdtEditTitle').value.trim();
  if (!titre) { toast('Le titre est requis.','error'); return; }
  var editorEl = document.querySelector('#mdtEditor .ql-editor');
  var contenu = editorEl ? editorEl.innerHTML : (_quill ? _quill.root.innerHTML : '');
  try {
    var r = await DB.updateMdtPage(pageId, { titre: titre, contenu: contenu });
    if (r.error) throw r.error;
    toast('Page sauvegardée.','success');
    _mdtPages = await DB.getAllMdtPages();
    await openMdtPage(pageId);
  } catch(e) { toast(e.message,'error'); }
}

async function delMdtPage(pageId) {
  if (!confirm('Supprimer cette page ?')) return;
  var r = await DB.deleteMdtPage(pageId);
  if (r.error) { toast(r.error.message,'error'); return; }
  _mdtSelPage = null;
  toast('Page supprimée.','info');
  _mdtPages = await DB.getAllMdtPages();
  renderMdtList();
  var main = document.getElementById('mdtMain');
  if (main) main.innerHTML = '<div class="empty-state"><div class="empty-icon">📚</div><div class="empty-title">Page supprimée</div></div>';
}

function openMdtNewPage() {
  openModal({
    eyebrow: 'NOUVELLE PAGE MDT',
    title: 'Créer une page',
    size: 'sm',
    body: fld('Titre *', 'text', 'npTitre', '', 'Ex: Code pénal — Infractions'),
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="createMdtPage()">Créer</button>'
  });
}

function insertMdtImage() {
  var url = document.getElementById('imgUrl').value.trim();
  if (!url) { toast('URL requise.','error'); return; }
  closeModal();
  if (_quill) {
    var range = _quill.getSelection() || { index: _quill.getLength() };
    _quill.insertEmbed(range.index, 'image', url);
    _quill.setSelection(range.index + 1);
  }
}

async function createMdtPage() {
  var titre = document.getElementById('npTitre').value.trim();
  if (!titre) { toast('Titre requis.','error'); return; }
  try {
    var r = await DB.createMdtPage({ titre: titre, contenu: '', ordre: _mdtPages.length });
    if (r.error) throw r.error;
    closeModal(); toast('Page créée.','success');
    _mdtPages = await DB.getAllMdtPages();
    renderMdtList();
    if (r.data) await openMdtPage(r.data.id);
  } catch(e) { toast(e.message,'error'); }
}

// ══ VEHICLES ═══════════════════════════════════════════════════════
async function renderVehicles() {
  if (!_vehicleCatId) _vehicleCatId = await DB.getOrCreateVehicleCat();
  _vehiclePages = await DB.getAllVehiclePages(_vehicleCatId);

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div><h1 style="font-size:1.4rem">Véhicules</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Parc automobile de la SASP</p></div>' +
      (canWrite() ? '<button class="btn btn-primary btn-sm" onclick="openVehicleNewPage()">+ Nouvelle page</button>' : '') +
    '</div>' +
    '<div class="mdt-layout">' +
      '<aside class="mdt-sidebar"><div id="vehicleList"></div></aside>' +
      '<div class="mdt-main" id="vehicleMain">' +
        '<div class="empty-state"><div class="empty-icon">🚗</div><div class="empty-title">Sélectionnez une page</div></div>' +
      '</div>' +
    '</div>'
  );
  renderVehicleList();
}

function renderVehicleList() {
  var el = document.getElementById('vehicleList');
  if (!el) return;
  if (!_vehiclePages.length) {
    el.innerHTML = '<p style="color:var(--t3);font-size:.8rem;text-align:center;padding:20px 8px">Aucune page.' +
      (canWrite() ? '<br>Cliquez sur "+ Nouvelle page".' : '') + '</p>';
    return;
  }
  el.innerHTML = _vehiclePages.map(function(p, i) {
    return '<div class="mdt-page-item' + (_mdtSelPage===p.id?' active':'') + '" onclick="openVehiclePage(\'' + p.id + '\')" style="justify-content:space-between">' +
      '<span>🚗 ' + esc(p.titre) + '</span>' + movePageBtns(p.id, i, _vehiclePages.length, 'vehicle') + '</div>';
  }).join('');
}

async function openVehiclePage(pageId) {
  _mdtSelPage = pageId;
  renderVehicleList();
  var page = await DB.getMdtPage(pageId);
  if (!page) return;
  var main = document.getElementById('vehicleMain');
  if (!main) return;
  main.innerHTML =
    '<div class="card mb-14">' +
      '<div class="flex-between flex-wrap gap-8">' +
        '<div><h2 style="font-size:1.3rem">' + esc(page.titre) + '</h2>' +
        '<div class="mono" style="font-size:.64rem;color:var(--t3);margin-top:3px">Modifié le ' + fmt(page.updated_at) + '</div></div>' +
        (canWrite() ? '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-outline btn-sm" onclick="editVehiclePage(\'' + pageId + '\')">✏️ Modifier</button>' +
          '<button class="btn btn-danger btn-sm" onclick="delVehiclePage(\'' + pageId + '\')">Supprimer</button>' +
        '</div>' : '') +
      '</div>' +
    '</div>' +
    '<div class="card ql-view" style="min-height:300px;font-size:.9rem;line-height:1.7;color:var(--t1)">' +
      (page.contenu || '<p class="text-muted">Page vide. Cliquez sur "Modifier" pour ajouter du contenu.</p>') +
    '</div>';
}

async function editVehiclePage(pageId) {
  var page = await DB.getMdtPage(pageId);
  if (!page) return;
  var main = document.getElementById('vehicleMain');
  main.innerHTML =
    '<div class="card mb-14">' +
      '<div class="flex-between flex-wrap gap-8">' +
        '<input class="form-control" id="vehicleEditTitle" value="' + esc(page.titre) + '" style="font-size:1.1rem;font-weight:700;max-width:400px">' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn btn-ghost btn-sm" onclick="openVehiclePage(\'' + pageId + '\')">Annuler</button>' +
          '<button class="btn btn-primary btn-sm" onclick="saveVehiclePage(\'' + pageId + '\')">💾 Sauvegarder</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div id="vehicleEditor"></div>';

  _quill = new Quill('#vehicleEditor', {
    theme: 'snow',
    modules: {
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['blockquote', 'link', 'image'],
          [{ color: [] }, { align: [] }]
        ],
        handlers: {
          image: function() {
            openModal({
              eyebrow: 'INSÉRER UNE IMAGE',
              title: 'URL de l\'image',
              size: 'sm',
              body: fld('Lien direct *', 'url', 'imgUrl', '', 'https://i.imgur.com/...'),
              footer: '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
                '<button class="btn btn-primary" onclick="insertMdtImage()">Insérer</button>'
            });
          }
        }
      }
    }
  });
  if (page.contenu) _quill.clipboard.dangerouslyPasteHTML(0, page.contenu);
}

async function saveVehiclePage(pageId) {
  var titre = document.getElementById('vehicleEditTitle').value.trim();
  if (!titre) { toast('Le titre est requis.','error'); return; }
  var editorEl = document.querySelector('#vehicleEditor .ql-editor');
  var contenu = editorEl ? editorEl.innerHTML : (_quill ? _quill.root.innerHTML : '');
  try {
    var r = await DB.updateMdtPage(pageId, { titre: titre, contenu: contenu });
    if (r.error) throw r.error;
    toast('Page sauvegardée.','success');
    _vehiclePages = await DB.getAllVehiclePages(_vehicleCatId);
    await openVehiclePage(pageId);
  } catch(e) { toast(e.message,'error'); }
}

async function delVehiclePage(pageId) {
  if (!confirm('Supprimer cette page ?')) return;
  var r = await DB.deleteMdtPage(pageId);
  if (r.error) { toast(r.error.message,'error'); return; }
  _mdtSelPage = null;
  toast('Page supprimée.','info');
  _vehiclePages = await DB.getAllVehiclePages(_vehicleCatId);
  renderVehicleList();
  var main = document.getElementById('vehicleMain');
  if (main) main.innerHTML = '<div class="empty-state"><div class="empty-icon">🚗</div><div class="empty-title">Page supprimée</div></div>';
}

function openVehicleNewPage() {
  openModal({
    eyebrow: 'NOUVELLE PAGE VÉHICULE',
    title: 'Créer une page',
    size: 'sm',
    body: fld('Titre *', 'text', 'vpTitre', '', 'Ex: Ford Crown Victoria'),
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="createVehiclePage()">Créer</button>'
  });
}

async function createVehiclePage() {
  var titre = document.getElementById('vpTitre').value.trim();
  if (!titre) { toast('Titre requis.','error'); return; }
  try {
    var r = await DB.createVehiclePage(_vehicleCatId, { titre: titre, contenu: '', ordre: _vehiclePages.length });
    if (r.error) throw r.error;
    closeModal(); toast('Page créée.','success');
    _vehiclePages = await DB.getAllVehiclePages(_vehicleCatId);
    renderVehicleList();
    if (r.data) await openVehiclePage(r.data.id);
  } catch(e) { toast(e.message,'error'); }
}

// ══ COMPLÉTUDE FICHES ═══════════════════════════════════════════════
window.postCompletudDiscord = async function(btn) {
  var orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Envoi…';
  try {
    var res = await fetch(WORKER_BASE + '/admin/post-completude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cid_inventory: collectCidWeaponInventory() })
    });
    var data = await res.json();
    btn.textContent = data.ok ? '✅ Envoyé !' : '❌ Erreur';
  } catch(e) {
    btn.textContent = '❌ Erreur';
  }
  setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 2500);
};

function normalizeSerial(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

function collectCidWeaponInventory() {
  var cases = [];
  try { cases = typeof cidLoad === 'function' ? cidLoad() : []; } catch(e) { cases = []; }
  var rows = [];
  (cases || []).forEach(function(c) {
    (c.preuves || []).forEach(function(p) {
      if (String(p.type || '').toLowerCase() !== 'arme') return;
      var d = p.details || {};
      rows.push({
        source: 'CID',
        case_id: c.id || '',
        case_numero: c.numero || '',
        case_title: c.titre || '',
        scelle: p.scelle || '',
        nom: d.type_arme || p.description || 'Arme',
        serie: d.numero_serie || '',
        suspect: cidPersonNameById(c, d.suspect_id) || ''
      });
    });
  });
  return rows;
}

function buildSerialInventory(agentWeapons, cidWeapons) {
  var rows = [];
  (agentWeapons || []).forEach(function(w) {
    var a = w.agent || {};
    rows.push({
      source: 'Agent',
      nom: w.nom || 'Arme',
      serie: w.serie || '',
      serial_key: normalizeSerial(w.serie),
      owner: a.id ? ((a.prenom || '') + ' ' + (a.nom || '') + ' (' + (a.matricule || '—') + ')') : 'Agent inconnu',
      agent_id: a.id || '',
      detail: w.ppa_niveau ? 'PPA ' + w.ppa_niveau : 'Sans PPA'
    });
  });
  (cidWeapons || []).forEach(function(w) {
    rows.push({
      source: 'CID',
      nom: w.nom || 'Arme',
      serie: w.serie || '',
      serial_key: normalizeSerial(w.serie),
      owner: (w.case_numero || 'CID') + (w.case_title ? ' — ' + w.case_title : ''),
      agent_id: '',
      detail: [w.scelle, w.suspect ? 'Suspect: ' + w.suspect : ''].filter(Boolean).join(' · ')
    });
  });
  var counts = {};
  rows.forEach(function(r) { if (r.serial_key) counts[r.serial_key] = (counts[r.serial_key] || 0) + 1; });
  rows.forEach(function(r) { r.duplicate = !!r.serial_key && counts[r.serial_key] > 1; });
  return rows;
}

async function renderCompletude() {
  var [agents, agentWeapons] = await Promise.all([
    DB.getAgents({}),
    DB.getAllAgentArmes ? DB.getAllAgentArmes() : Promise.resolve([])
  ]);
  var cidWeapons = collectCidWeaponInventory();
  var serialInventory = buildSerialInventory(agentWeapons, cidWeapons);
  var missingSerials = serialInventory.filter(function(r){ return !r.serial_key; }).length;
  var duplicates = serialInventory.filter(function(r){ return r.duplicate; }).length;
  var FIELDS = [
    { key: 'iban',            label: 'IBAN' },
    { key: 'telephone',       label: 'Téléphone' },
    { key: 'date_naissance',  label: 'Date naiss.' },
    { key: 'date_recrutement',label: 'Date recrut.' },
    { key: 'discord_id',      label: 'Discord' },
  ];
  var ok   = '<span style="color:#2ecc71;font-size:1rem">✓</span>';
  var nok  = '<span style="color:#e74c3c;font-size:1rem;font-weight:700">✗</span>';

  var rows = agents.map(function(a) {
    var missing = FIELDS.filter(function(f){ return !a[f.key]; }).length;
    var rowStyle = missing > 0 ? 'cursor:pointer' : 'cursor:pointer;opacity:.6';
    return '<tr onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})" style="' + rowStyle + '">' +
      '<td class="mono text-gold">' + esc(a.matricule) + '</td>' +
      '<td style="font-weight:600;color:var(--t0)">' + esc(a.prenom) + ' ' + esc(a.nom) + '</td>' +
      '<td>' + gradeBadge(a.grade) + '</td>' +
      FIELDS.map(function(f){ return '<td style="text-align:center">' + (a[f.key] ? ok : nok) + '</td>'; }).join('') +
      '<td style="text-align:center"><span class="badge ' + (missing===0?'badge-green':'badge-red') + '" style="font-size:.65rem">' + (missing===0?'Complet':missing+' manquant'+(missing>1?'s':'')) + '</span></td>' +
    '</tr>';
  }).join('');

  var incomplete = agents.filter(function(a){ return FIELDS.some(function(f){ return !a[f.key]; }); }).length;
  var inventoryRows = serialInventory.length ? serialInventory.map(function(r) {
    return '<tr' + (r.agent_id ? ' onclick="navigate(\'agent-profile\',{id:\'' + r.agent_id + '\'})" style="cursor:pointer"' : '') + '>' +
      '<td><span class="badge ' + (r.source === 'CID' ? 'badge-blue' : 'badge-gold') + '" style="font-size:.65rem">' + esc(r.source) + '</span></td>' +
      '<td style="font-weight:600;color:var(--t0)">' + esc(r.nom) + '</td>' +
      '<td class="mono ' + (r.serial_key ? 'text-gold' : 'text-muted') + '">' + (r.serie ? esc(r.serie) : '—') + '</td>' +
      '<td>' + esc(r.owner || '—') + '</td>' +
      '<td style="color:var(--t3);font-size:.78rem">' + esc(r.detail || '—') + '</td>' +
      '<td style="text-align:center">' + (r.duplicate ? '<span class="badge badge-red" style="font-size:.65rem">Doublon</span>' : (r.serial_key ? ok : nok)) + '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="6"><div class="empty-state" style="padding:26px"><div class="empty-icon">🔫</div><div class="empty-title">Aucune arme inventoriée</div></div></td></tr>';

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div>' +
        '<h2 style="font-size:1.15rem;font-weight:700;color:var(--t0);margin:0">Complétude des fiches agents</h2>' +
        '<div style="font-size:.78rem;color:var(--t3);margin-top:3px">' + agents.length + ' agents actifs — ' +
          '<span style="color:' + (incomplete?'#e74c3c':'#2ecc71') + '">' + incomplete + ' fiche' + (incomplete!==1?'s':'') + ' incomplète' + (incomplete!==1?'s':'') + '</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        (isAdmin() ? '<button class="btn btn-ghost btn-sm" onclick="syncGradesFromDiscord(this)">⬇️ Grades Discord</button>' : '') +
        (canWrite() ? '<button class="btn btn-ghost btn-sm" onclick="postCompletudDiscord(this)">📤 Envoyer sur Discord</button>' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="navigate(\'agents\')">← Retour agents</button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<table class="table">' +
        '<thead><tr>' +
          '<th>Matricule</th><th>Agent</th><th>Grade</th>' +
          FIELDS.map(function(f){ return '<th style="text-align:center">' + f.label + '</th>'; }).join('') +
          '<th style="text-align:center">Statut</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>' +
    '<div class="flex-between mb-12 mt-20 flex-wrap gap-8">' +
      '<div>' +
        '<h2 style="font-size:1.05rem;font-weight:700;color:var(--t0);margin:0">Inventaire numéros de série</h2>' +
        '<div style="font-size:.78rem;color:var(--t3);margin-top:3px">' + serialInventory.length + ' arme' + (serialInventory.length!==1?'s':'') + ' inventoriée' + (serialInventory.length!==1?'s':'') + ' — ' +
          '<span style="color:' + (missingSerials?'#e74c3c':'#2ecc71') + '">' + missingSerials + ' sans S/N</span>' +
          (duplicates ? ' — <span style="color:#f39c12">' + duplicates + ' doublon' + (duplicates>1?'s':'') + '</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<table class="table">' +
        '<thead><tr><th>Source</th><th>Arme</th><th>S/N</th><th>Détenteur / dossier</th><th>Détail</th><th style="text-align:center">État</th></tr></thead>' +
        '<tbody>' + inventoryRows + '</tbody>' +
      '</table>' +
    '</div>'
  );
}

// ══ DISCIPLINARY ═══════════════════════════════════════════════════
// ══ ARCHIVES ════════════════════════════════════════════════════════
var _archiveSearch = '';
async function renderArchives() {
  await navigate('dashboard');
  return;
  var agents = await DB.getArchivedAgents(_archiveSearch);
  var rows = agents.length ? agents.map(function(a) {
    var unites = (a.unites||[]).map(function(u){ return unitBadge(u); }).join(' ');
    var ppas = ppaCount(a);
    return '<tr onclick="openArchivedProfile(\'' + a.id + '\')" style="cursor:pointer">' +
      '<td class="mono text-gold">' + esc(a.matricule) + '</td>' +
      '<td style="font-weight:600;color:var(--t0)">' + esc(a.prenom) + ' ' + esc(a.nom) + '</td>' +
      '<td>' + gradeBadge(a.grade) + '</td>' +
      '<td>' + (unites||'<span class="text-muted">—</span>') + '</td>' +
      '<td><span class="badge badge-gold" style="font-size:.65rem">PPA ' + ppas + '/3</span></td>' +
      '<td onclick="event.stopPropagation()" style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="openArchivedProfile(\'' + a.id + '\')">Fiche</button>' +
        (isAdmin() ? ' <button class="btn btn-danger btn-sm" onclick="deleteArchivedAgent(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\')">Supprimer</button>' : '') +
      '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="6"><div class="empty-state" style="padding:40px"><div class="empty-icon">🗃️</div><div class="empty-title">Aucun agent archivé</div></div></td></tr>';

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div><h1 style="font-size:1.4rem">Archives</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">' + agents.length + ' agent(s) archivé(s) — consultation uniquement</p></div>' +
    '</div>' +
    '<div class="filter-bar">' +
      '<div class="search-wrap" style="max-width:320px"><span class="search-icon">🔍</span>' +
        '<input class="form-control search-input" placeholder="Nom, prénom, matricule…" value="' + esc(_archiveSearch) + '" oninput="archiveSearch(this.value)">' +
      '</div>' +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>MATRICULE</th><th>NOM</th><th>GRADE</th><th>DIVISIONS</th><th>PPA</th><th>ACTIONS</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
    '</div>'
  );
}
var _archSearchTimer;
function archiveSearch(v) {
  clearTimeout(_archSearchTimer);
  _archSearchTimer = setTimeout(function(){ _archiveSearch = v; renderArchives(); }, 280);
}
function openArchivedProfile(id) {
  navigate('agent-profile', { id: id });
}
async function deleteArchivedAgent(id, name) {
  if (!confirm('Supprimer définitivement ' + name + ' ?\n\nCette action est irréversible — toutes les données seront perdues.')) return;
  var r = await DB.deleteAgent(id);
  if (r.error) { toast(r.error.message, 'error'); return; }
  toast('Dossier supprimé définitivement.', 'info');
  sendLog('🗑️ Agent supprimé', 0xe74c3c, [
    { name: 'Agent', value: name, inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  renderArchives();
}
async function openNotesModal(agentId) {
  var ag = await DB.getAgent(agentId);
  openModal({
    eyebrow: 'NOTES INTERNES',
    title: 'Notes — visibles staff uniquement',
    body: '<div class="form-group"><textarea class="form-control" id="notesText" rows="6" placeholder="Observations, remarques, suivi...">' + esc(ag && ag.notes || '') + '</textarea></div>',
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-primary" onclick="saveNotes(\'' + agentId + '\')">Enregistrer</button>'
  });
}

async function saveNotes(agentId) {
  var notes = document.getElementById('notesText').value.trim() || null;
  await DB.updateAgent(agentId, { notes: notes });
  closeModal();
  toast('Notes enregistrées.', 'success');
  await renderAgentProfile();
}

async function renderAcademie() {
  var agents = await DB.getAgents({});
  var recrues = agents.filter(function(a) {
    return (a.grade === 'Rookie' || a.grade === 'Trooper I') && a.statut !== 'Archivé';
  });
  var formateurMap = {};
  agents.filter(function(a){ return a.is_formateur; }).forEach(function(f){ formateurMap[f.id] = f; });

  var nRookie  = recrues.filter(function(r){ return r.grade === 'Rookie'; }).length;
  var nOfficer = recrues.filter(function(r){ return r.grade === 'Officer I'; }).length;

  var groups = {};
  recrues.forEach(function(r) {
    var fId = r.formateur_id || '__none__';
    if (!groups[fId]) groups[fId] = [];
    groups[fId].push(r);
  });

  function recrueRow(r) {
    var blames = (r.blame1?1:0)+(r.blame2?1:0)+(r.blame3?1:0);
    var ppaDots = [1,2,3].map(function(n) {
      return '<span title="PPA '+n+'" style="width:22px;height:22px;border-radius:50%;font-size:.65rem;display:flex;align-items:center;justify-content:center;font-weight:700;' +
        (r['ppa'+n] ? 'background:rgba(201,168,76,.3);color:var(--gold)' : 'background:var(--bg2);color:var(--t3)') + '">' + n + '</span>';
    }).join('');
    return '<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid var(--border0);cursor:pointer" onclick="navigate(\'agent-profile\',{id:\'' + r.id + '\'})">' +
      '<div style="flex:1">' +
        '<div style="font-size:.9rem;font-weight:600;color:var(--t0)">' + esc(r.prenom + ' ' + r.nom) + ' <span style="font-size:.75rem;color:var(--t3)">(' + esc(r.matricule) + ')</span></div>' +
        (r.notes ? '<div style="font-size:.72rem;color:var(--t3);margin-top:2px">' + esc(r.notes.slice(0,80)) + (r.notes.length>80?'…':'') + '</div>' : '') +
      '</div>' +
      gradeBadge(r.grade) +
      '<div style="display:flex;gap:4px">' + ppaDots + '</div>' +
      (blames > 0 ? '<span class="badge badge-red" style="font-size:.7rem">⚠️ ' + blames + '</span>' : '') +
      '<span style="color:var(--t3);font-size:.8rem">›</span>' +
    '</div>';
  }

  var groupsHtml = '';
  var ordered = Object.keys(groups).filter(function(k){ return k !== '__none__'; });
  ordered.forEach(function(fId) {
    var f = formateurMap[fId] || agents.find(function(a){ return a.id === fId; });
    var list = groups[fId];
    groupsHtml += '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-head"><div class="card-icon">🎓</div><div>' +
        '<div class="card-title">Formateur : ' + esc(f ? f.prenom + ' ' + f.nom : '—') + (f ? ' <span style="color:var(--t3);font-size:.78rem">(' + esc(f.matricule) + ')</span>' : '') + '</div>' +
        '<div class="card-sub">' + list.length + ' recrue(s)</div>' +
      '</div></div>' +
      list.map(recrueRow).join('') +
    '</div>';
  });
  if (groups['__none__'] && groups['__none__'].length) {
    groupsHtml += '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-head"><div class="card-icon">❓</div><div><div class="card-title">Sans formateur assigné</div><div class="card-sub">' + groups['__none__'].length + ' recrue(s)</div></div></div>' +
      groups['__none__'].map(recrueRow).join('') +
    '</div>';
  }
  if (!recrues.length) {
    groupsHtml = '<div class="empty-state"><div class="empty-icon">🎓</div><div class="empty-title">Aucune recrue en formation</div><div class="empty-sub">Les agents de grade Rookie ou Trooper I apparaissent ici.</div></div>';
  }

  setContent(
    '<div class="welcome-bar"><div><h1 style="font-size:1.5rem">Académie</h1><p class="text-muted" style="margin-top:3px;font-size:.84rem">Suivi des recrues en formation</p></div></div>' +
    '<div class="stats-grid">' +
      statCard('🎓', 'Recrues totales', recrues.length) +
      statCard('🟡', 'Rookie', nRookie) +
      statCard('🔵', 'Trooper I', nOfficer) +
      statCard('👤', 'Formateurs', Object.keys(formateurMap).length) +
    '</div>' +
    groupsHtml
  );
}

async function renderRecap() {
  var [agents, allArmes] = await Promise.all([
    DB.getAgents({}),
    DB.getAgentArmes ? Promise.all([]).then(function(){ return []; }) : Promise.resolve([])
  ]);
  var agentMap = {};
  agents.forEach(function(a){ agentMap[a.id] = a; });

  var _filterGrade  = '';
  var _filterStatut = '';

  function buildCards() {
    var filtered = agents.filter(function(a){
      if (a.statut === 'Archivé') return false;
      if (_filterGrade  && a.grade  !== _filterGrade)  return false;
      if (_filterStatut && a.statut !== _filterStatut) return false;
      return true;
    });
    filtered.sort(function(a,b){
      return parseInt(a.matricule||'99',10) - parseInt(b.matricule||'99',10);
    });
    if (!filtered.length) return '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Aucun agent</div></div>';
    return filtered.map(function(a) {
      var formateur = a.formateur_id ? agentMap[a.formateur_id] : null;
      var divs = (a.unites||[]).map(unitBadge).join(' ') || '<span style="color:var(--t3);font-size:.75rem">—</span>';
      var blameCount = (a.blame1?1:0)+(a.blame2?1:0)+(a.blame3?1:0);
        var statusColor = a.statut === 'En service' ? '#2ecc71' : a.statut === 'En congé' ? '#f39c12' : '#e74c3c';
      return '<div class="recap-card" onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})">' +
        '<div class="recap-card-top">' +
          '<div class="recap-mat">' + esc(a.matricule) + '</div>' +
          '<div class="recap-info">' +
            '<div class="recap-name">' + esc(a.prenom) + ' <strong>' + esc(a.nom) + '</strong></div>' +
            '<div class="recap-meta">' +
              gradeBadge(a.grade) +
              '<span class="recap-status-dot" style="background:' + statusColor + '" title="' + esc(a.statut) + '"></span>' +
              '<span style="font-size:.72rem;color:var(--t3)">' + esc(a.statut) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="recap-card-body">' +
          '<div class="recap-field"><span class="recap-field-label">Tél.</span><span class="recap-field-val mono">' + (a.telephone ? fmtTel(a.telephone) : '<span class="muted">—</span>') + '</span></div>' +
          '<div class="recap-field"><span class="recap-field-label">IBAN</span><span class="recap-field-val mono">' + (a.iban || '<span class="muted">—</span>') + '</span></div>' +
          '<div class="recap-field"><span class="recap-field-label">Recrutement</span><span class="recap-field-val">' + (a.date_recrutement ? fmt(a.date_recrutement) : '<span class="muted">—</span>') + '</span></div>' +
          '<div class="recap-field"><span class="recap-field-label">Formateur</span><span class="recap-field-val">' + (formateur ? esc(formateur.prenom + ' ' + formateur.nom) : '<span class="muted">—</span>') + '</span></div>' +
        '</div>' +
        (((a.unites||[]).length || blameCount) ? '<div class="recap-card-foot">' +
          '<div style="display:flex;gap:5px;flex-wrap:wrap">' + divs + '</div>' +
          (blameCount ? '<span class="badge badge-red" style="font-size:.65rem;margin-left:auto">⚠️ ' + blameCount + ' blâme' + (blameCount>1?'s':'') + '</span>' : '') +
        '</div>' : '') +
      '</div>';
    }).join('');
  }

  function recapRow(icon, val) {
    return '<div style="display:flex;gap:6px;align-items:center;padding:2px 0;color:var(--t2)">' +
      '<span style="font-size:.8rem">' + icon + '</span>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(val) + '</span>' +
    '</div>';
  }

  var gradeOpts = '<option value="">Tous les grades</option>' +
    _grades.slice().sort(function(a,b){ return (b.ordre||0)-(a.ordre||0); }).map(function(g){
      return '<option value="' + esc(g.nom) + '">' + esc(gradeLabel(g.nom)) + '</option>';
    }).join('');
  var statutOpts = ['Tous les statuts','En service','En congé','Suspendu','Licencié','Retraité','Démission'].map(function(s,i){
    return '<option value="' + (i===0?'':s) + '">' + s + '</option>';
  }).join('');

  setContent(
    '<style>'
    + '.recap-card{background:var(--bgCard);border:1px solid var(--border1);border-radius:var(--rLg);overflow:hidden;cursor:pointer;transition:border-color .15s}'
    + '.recap-card:hover{border-color:var(--goldBorder)}'
    + '.recap-card-top{display:flex;align-items:center;gap:14px;padding:14px 16px}'
    + '.recap-mat{font-family:"Share Tech Mono",monospace;font-size:1.3rem;font-weight:800;color:var(--gold);min-width:40px;text-align:center;flex-shrink:0}'
    + '.recap-info{flex:1;min-width:0}'
    + '.recap-name{font-size:.95rem;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:5px}'
    + '.recap-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap}'
    + '.recap-status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}'
    + '.recap-card-body{display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--border0)}'
    + '.recap-field{display:flex;flex-direction:column;gap:1px;padding:8px 16px;border-bottom:1px solid var(--border0)}'
    + '.recap-field:nth-child(odd){border-right:1px solid var(--border0)}'
    + '.recap-field-label{font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);font-weight:600}'
    + '.recap-field-val{font-size:.78rem;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.recap-card-foot{display:flex;align-items:center;gap:6px;padding:8px 14px;border-top:1px solid var(--border0);flex-wrap:wrap}'
    + '</style>'
    + '<div class="welcome-bar"><div><h1 style="font-size:1.5rem">Récap agents</h1><p class="text-muted" style="font-size:.84rem;margin-top:3px">Vue d\'ensemble — toutes les informations</p></div></div>' +
    '<div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">' +
      '<select class="form-control" style="width:auto" id="recapFilterGrade" onchange="recapFilter()">' + gradeOpts + '</select>' +
      '<select class="form-control" style="width:auto" id="recapFilterStatut" onchange="recapFilter()">' + statutOpts + '</select>' +
      '<span id="recapCount" style="align-self:center;font-size:.82rem;color:var(--t3)"></span>' +
    '</div>' +
    '<div id="recapGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px"></div>'
  );

  window._recapAgents = agents;
  window._recapBuild  = buildCards;
  window.recapFilter  = function() {
    _filterGrade  = document.getElementById('recapFilterGrade').value;
    _filterStatut = document.getElementById('recapFilterStatut').value;
    document.getElementById('recapGrid').innerHTML = buildCards();
    var cnt = window._recapAgents.filter(function(a){
      if (a.statut==='Archivé') return false;
      if (_filterGrade  && a.grade  !== _filterGrade)  return false;
      if (_filterStatut && a.statut !== _filterStatut) return false;
      return true;
    }).length;
    var el = document.getElementById('recapCount');
    if (el) el.textContent = cnt + ' agent' + (cnt!==1?'s':'');
  };
  document.getElementById('recapGrid').innerHTML = buildCards();
  var total = agents.filter(function(a){ return a.statut !== 'Archivé'; }).length;
  var cnt = document.getElementById('recapCount');
  if (cnt) cnt.textContent = total + ' agent' + (total!==1?'s':'');
}

async function showMatriculesDispos() {
  var agents = await DB.getAgents({});
  var used = new Set(agents.map(function(a) { return String(a.matricule).trim(); }));
  var dispos = [];
  for (var i = 1; i <= 99; i++) {
    var padded = String(i).padStart(2, '0');
    if (!used.has(padded) && !used.has(String(i))) dispos.push(padded);
  }
  var html = '<div style="display:flex;flex-wrap:wrap;gap:8px;padding:4px 0">' +
    dispos.map(function(m) {
      return '<button class="btn btn-ghost btn-sm" style="font-weight:700;min-width:48px" onclick="pickMatricule(\'' + m + '\')">' + esc(m) + '</button>';
    }).join('') +
    '</div>';
  openModal({
    eyebrow: 'MATRICULES',
    title: 'Matricules disponibles (' + dispos.length + ' / 99)',
    body: html,
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Fermer</button>'
  });
}

async function pickMatricule(mat) {
  closeModal();
  await openAgentModal(null);
  var el = document.getElementById('agMatricule');
  if (el) el.value = mat;
}

async function deleteAgentDirect(id) {
  var agent = await DB.getAgent(id);
  if (!agent) { toast('Fiche agent introuvable.', 'error'); return; }
  if (!confirm('Supprimer definitivement la fiche de ' + agent.prenom + ' ' + agent.nom + ' ?\n\nCette action est irreversible.')) return;
  var r = await DB.deleteAgent(id);
  if (r.error) { toast(r.error.message, 'error'); return; }
  toast('Fiche agent supprimee.', 'info');
  sendLog('Agent supprime', 0xe74c3c, [
    { name: 'Agent', value: agent.prenom + ' ' + agent.nom + ' - ' + agent.matricule, inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  refreshAgentList();
  navigate('agents');
}

async function archiveAgent(id) {
  return deleteAgentDirect(id);
}
// ══ WIKI GÉNÉRIQUE ══════════════════════════════════════════════════
async function renderWikiSection(slug, cfg) {
  _wikiSlug = slug;
  if (!_wikiCats[slug]) _wikiCats[slug] = await DB.getOrCreateWikiCat(slug);
  _wikiPages[slug] = await DB.getAllVehiclePages(_wikiCats[slug]);
  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div><h1 style="font-size:1.4rem">' + cfg.title + '</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">' + cfg.sub + '</p></div>' +
      (canWrite() ? '<button class="btn btn-primary btn-sm" onclick="openWikiNewPage()">+ Nouvelle page</button>' : '') +
    '</div>' +
    '<div class="mdt-layout">' +
      '<aside class="mdt-sidebar"><div id="wikiList"></div></aside>' +
      '<div class="mdt-main" id="wikiMain">' +
        '<div class="empty-state"><div class="empty-icon">' + cfg.icon + '</div><div class="empty-title">S\xE9lectionnez une page</div></div>' +
      '</div>' +
    '</div>'
  );
  renderWikiList(slug, cfg.icon);
}
function renderWikiList(slug, icon) {
  var el = document.getElementById('wikiList');
  if (!el) return;
  var pages = _wikiPages[slug] || [];
  if (!pages.length) {
    el.innerHTML = '<p style="color:var(--t3);font-size:.8rem;text-align:center;padding:20px 8px">Aucune page.' + (canWrite() ? '<br>Cliquez sur "+ Nouvelle page".' : '') + '</p>';
    return;
  }
  el.innerHTML = pages.map(function(p, i){
    return '<div class="mdt-page-item' + (_mdtSelPage===p.id?' active':'') + '" onclick="openWikiPage(\'' + p.id + '\')" style="justify-content:space-between">' +
      '<span>' + (icon||'📄') + ' ' + esc(p.titre) + '</span>' + movePageBtns(p.id, i, pages.length, 'wiki') + '</div>';
  }).join('');
}
async function openWikiPage(pageId) {
  _mdtSelPage = pageId;
  renderWikiList(_wikiSlug);
  var page = await DB.getMdtPage(pageId);
  if (!page) return;
  var main = document.getElementById('wikiMain');
  if (!main) return;
  main.innerHTML =
    '<div class="card mb-14"><div class="flex-between flex-wrap gap-8">' +
      '<div><h2 style="font-size:1.3rem">' + esc(page.titre) + '</h2>' +
      '<div class="mono" style="font-size:.64rem;color:var(--t3);margin-top:3px">Modifi\xE9 le ' + fmt(page.updated_at) + '</div></div>' +
      (canWrite() ? '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-outline btn-sm" onclick="editWikiPage(\'' + pageId + '\')">✏️ Modifier</button>' +
        '<button class="btn btn-danger btn-sm" onclick="delWikiPage(\'' + pageId + '\')">Supprimer</button>' +
      '</div>' : '') +
    '</div></div>' +
    '<div class="card ql-view" style="min-height:300px;font-size:.9rem;line-height:1.7;color:var(--t1)">' +
      (page.contenu || '<p class="text-muted">Page vide. Cliquez sur "Modifier".</p>') +
    '</div>';
}
async function editWikiPage(pageId) {
  var page = await DB.getMdtPage(pageId);
  if (!page) return;
  var main = document.getElementById('wikiMain');
  main.innerHTML =
    '<div class="card mb-14"><div class="flex-between flex-wrap gap-8">' +
      '<input class="form-control" id="wikiEditTitle" value="' + esc(page.titre) + '" style="font-size:1.1rem;font-weight:700;max-width:400px">' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-ghost btn-sm" onclick="openWikiPage(\'' + pageId + '\')">Annuler</button>' +
        '<button class="btn btn-primary btn-sm" onclick="saveWikiPage(\'' + pageId + '\')">💾 Sauvegarder</button>' +
      '</div>' +
    '</div></div>' +
    '<div id="wikiEditor"></div>';
  _quill = new Quill('#wikiEditor', {
    theme: 'snow',
    modules: { toolbar: { container: [[{header:[1,2,3,false]}],['bold','italic','underline','strike'],[{list:'ordered'},{list:'bullet'}],['blockquote','link','image'],[{color:[]},{align:[]}]], handlers:{ image:function(){ openModal({ eyebrow:'INS\xC9RER UNE IMAGE', title:"URL de l'image", size:'sm', body:fld('Lien direct *','url','imgUrl','','https://i.imgur.com/...'), footer:'<button class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="insertMdtImage()">Ins\xE9rer</button>' }); } } } }
  });
  if (page.contenu) _quill.clipboard.dangerouslyPasteHTML(0, page.contenu);
}
async function saveWikiPage(pageId) {
  var titre = document.getElementById('wikiEditTitle').value.trim();
  if (!titre) { toast('Le titre est requis.','error'); return; }
  var editorEl = document.querySelector('#wikiEditor .ql-editor');
  var contenu = editorEl ? editorEl.innerHTML : (_quill ? _quill.root.innerHTML : '');
  try {
    var r = await DB.updateMdtPage(pageId, { titre: titre, contenu: contenu });
    if (r.error) throw r.error;
    toast('Page sauvegard\xE9e.','success');
    _wikiPages[_wikiSlug] = await DB.getAllVehiclePages(_wikiCats[_wikiSlug]);
    await openWikiPage(pageId);
  } catch(e) { toast(e.message,'error'); }
}
async function delWikiPage(pageId) {
  if (!confirm('Supprimer cette page ?')) return;
  var r = await DB.deleteMdtPage(pageId);
  if (r.error) { toast(r.error.message,'error'); return; }
  _mdtSelPage = null;
  toast('Page supprim\xE9e.','info');
  _wikiPages[_wikiSlug] = await DB.getAllVehiclePages(_wikiCats[_wikiSlug]);
  renderWikiList(_wikiSlug);
  var main = document.getElementById('wikiMain');
  if (main) main.innerHTML = '<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-title">Page supprim\xE9e</div></div>';
}
function openWikiNewPage() {
  openModal({
    eyebrow: 'NOUVELLE PAGE',
    title: 'Cr\xE9er une page',
    size: 'sm',
    body: fld('Titre *','text','wikiNewTitre','','Ex : Proc\xE9dure d\'arrestation'),
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="createWikiPage()">Cr\xE9er</button>'
  });
}
async function createWikiPage() {
  var titre = document.getElementById('wikiNewTitre').value.trim();
  if (!titre) { toast('Titre requis.','error'); return; }
  var catId = _wikiCats[_wikiSlug];
  try {
    var r = await DB.createVehiclePage(catId, { titre: titre, contenu: '', ordre: (_wikiPages[_wikiSlug]||[]).length });
    if (r.error) throw r.error;
    closeModal(); toast('Page cr\xE9\xE9e.','success');
    _wikiPages[_wikiSlug] = await DB.getAllVehiclePages(catId);
    renderWikiList(_wikiSlug);
    if (r.data) await openWikiPage(r.data.id);
  } catch(e) { toast(e.message,'error'); }
}

// ══ STATS ══════════════════════════════════════════════════════════
async function renderStats() {
  var { agents, recentHist } = await DB.getStats();

  var total = agents.length;
  var actifs = agents.filter(function(a){ return a.statut==='En service'; }).length;
  var ppa1c = agents.filter(function(a){ return a.ppa1; }).length;
  var ppa2c = agents.filter(function(a){ return a.ppa2; }).length;
  var ppa3c = agents.filter(function(a){ return a.ppa3; }).length;
  var sanctions = recentHist.filter(function(h){ return h.type==='sanction'; }).length;
  var promotions = recentHist.filter(function(h){ return h.type==='promotion'; }).length;

  var gradeCounts = {};
  agents.forEach(function(a){ gradeCounts[a.grade] = (gradeCounts[a.grade]||0)+1; });

  var unitCounts = {};
  _units.forEach(function(u){ unitCounts[u.code] = 0; });
  agents.forEach(function(a){ (a.unites||[]).forEach(function(u){ if(unitCounts[u]!==undefined) unitCounts[u]++; }); });

  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Statistiques</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Vue d\'ensemble de la SASP</p></div></div>' +

    '<div class="stats-grid mb-20">' +
      statCard('👮', 'Agents total', total) +
      statCard('✅', 'Actifs', actifs) +
      statCard('📚', 'PPA 3 validé', ppa3c) +
      statCard('⚠️', 'Sanctions (30j)', sanctions) +
      statCard('🎖️', 'Promotions (30j)', promotions) +
    '</div>' +

    '<div class="page-grid2">' +
      '<div class="card"><div class="card-head"><div class="card-icon">🎖️</div><div><div class="card-title">Répartition par grade</div></div></div><div class="chart-wrap"><canvas id="chartGrades"></canvas></div></div>' +
      '<div class="card"><div class="card-head"><div class="card-icon">🚔</div><div><div class="card-title">Effectifs par unité</div></div></div><div class="chart-wrap"><canvas id="chartUnits"></canvas></div></div>' +
    '</div>' +

    '<div class="card" style="margin-top:18px">' +
      '<div class="card-head"><div class="card-icon">📚</div><div><div class="card-title">Formations PPA</div></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">' +
        ppaStatCard('PPA 1', ppa1c, total) +
        ppaStatCard('PPA 2', ppa2c, total) +
        ppaStatCard('PPA 3', ppa3c, total) +
      '</div>' +
    '</div>'
  );

  // Charts
  var gradeLabels = Object.keys(gradeCounts);
  var gradeData   = Object.values(gradeCounts);
  var colors = ['#E74C3C','#E67E22','#F1C40F','#2ECC71','#1ABC9C','#3498DB','#9B59B6','#FF6B9D','#00BCD4','#FF5722','#8BC34A','#795548'];

  var ctxG = document.getElementById('chartGrades');
  if (ctxG) {
    _charts.grades = new Chart(ctxG, {
      type: 'doughnut',
      data: { labels: gradeLabels, datasets: [{ data: gradeData, backgroundColor: colors, borderWidth: 1, borderColor: '#111318' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position:'right', labels:{ color:'#8C8368', font:{size:11} } } } }
    });
  }
  var ctxU = document.getElementById('chartUnits');
  if (ctxU) {
    _charts.units = new Chart(ctxU, {
      type: 'bar',
      data: { labels: Object.keys(unitCounts), datasets: [{ data: Object.values(unitCounts), backgroundColor: ['rgba(59,130,246,.5)','rgba(245,158,11,.5)','rgba(231,76,60,.5)','rgba(76,175,80,.5)','rgba(201,168,76,.5)'], borderRadius: 4, borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display:false } }, scales: { x:{ ticks:{ color:'#8C8368' }, grid:{ color:'rgba(201,168,76,.06)' } }, y:{ ticks:{ color:'#8C8368', stepSize:1 }, grid:{ color:'rgba(201,168,76,.06)' } } } }
    });
  }
}

function ppaStatCard(label, count, total) {
  var pct = total ? Math.round(count/total*100) : 0;
  return '<div style="background:var(--bg2);border:1px solid var(--border0);border-radius:var(--rMd);padding:16px;text-align:center">' +
    '<div style="font-family:\'Rajdhani\',sans-serif;font-size:1.8rem;font-weight:700;color:var(--gold)">' + count + '</div>' +
    '<div style="font-size:.7rem;color:var(--t3);font-family:\'Share Tech Mono\',monospace;margin-bottom:8px">' + label + '</div>' +
    '<div style="background:var(--border0);border-radius:3px;height:4px;overflow:hidden">' +
      '<div style="background:var(--gold);height:100%;width:' + pct + '%;border-radius:3px"></div>' +
    '</div>' +
    '<div style="font-size:.7rem;color:var(--t3);margin-top:4px">' + pct + '%</div>' +
  '</div>';
}

// ══ SEARCH ════════════════════════════════════════════════════════
async function renderSearch() {
  var q = S.pd.q || '';
  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Recherche globale</h1></div></div>' +
    '<div class="search-wrap mb-20" style="max-width:600px"><span class="search-icon" style="font-size:1.1rem">🔍</span>' +
      '<input class="form-control search-input" id="globalSearchInput" placeholder="Rechercher agent, matricule, numéro de série, MDT…" value="' + esc(q) + '" oninput="globalSearch(this.value)" style="font-size:1rem;padding:13px 13px 13px 38px">' +
    '</div>' +
    '<div id="searchResults">' + (q ? '' : '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Tapez pour rechercher…</div></div>') + '</div>'
  );
  if (q) await doSearch(q);
  var input = document.getElementById('globalSearchInput');
  if (input) input.focus();
}

var _searchGTimer = null;
function globalSearch(v) {
  clearTimeout(_searchGTimer);
  _searchGTimer = setTimeout(function(){ S.pd.q = v; doSearch(v); }, 250);
}

async function doSearch(q) {
  var el = document.getElementById('searchResults');
  if (!el) return;
  if (!q || q.length < 2) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Tapez au moins 2 caractères</div></div>';
    return;
  }
  el.innerHTML = '<div class="loader-block" style="padding:30px"><div class="spinner"></div></div>';
  var { agents, mdt, armes } = await DB.search(q);
  var qNorm = normalizeSerial(q);
  var cidArmes = collectCidWeaponInventory().filter(function(w) {
    return normalizeSerial(w.serie).indexOf(qNorm) !== -1 || String(w.nom || '').toLowerCase().indexOf(String(q || '').toLowerCase()) !== -1;
  });

  var html = '';
  if (agents.length) {
    html += '<div class="card mb-14"><div class="card-head"><div class="card-icon">👮</div><div><div class="card-title">Agents</div><div class="card-sub">' + agents.length + ' RÉSULTAT(S)</div></div></div>' +
      agents.map(function(a){ return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border0);cursor:pointer" onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})">' +
        '<span class="mono text-gold">' + esc(a.matricule) + '</span>' +
        '<span style="font-weight:600;color:var(--t0);flex:1">' + esc(a.prenom+' '+a.nom) + '</span>' +
        gradeBadge(a.grade) + statusBadge(a.statut) +
      '</div>'; }).join('') + '</div>';
  }
  if ((armes || []).length) {
    html += '<div class="card mb-14"><div class="card-head"><div class="card-icon">🔫</div><div><div class="card-title">Numéros de série</div><div class="card-sub">' + armes.length + ' RÉSULTAT(S)</div></div></div>' +
      armes.map(function(w){
        var a = w.agent || {};
        var hasAgent = !!a.id;
        return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border0);' + (hasAgent?'cursor:pointer':'') + '" ' + (hasAgent ? 'onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})"' : '') + '>' +
          '<span class="mono text-gold" style="min-width:110px">' + esc(w.serie || '—') + '</span>' +
          '<span style="font-weight:600;color:var(--t0);flex:1">' + esc(w.nom || 'Arme') + '</span>' +
          '<span style="font-size:.8rem;color:var(--t2)">' + (hasAgent ? esc((a.prenom || '') + ' ' + (a.nom || '') + ' (' + (a.matricule || '—') + ')') : 'Agent inconnu') + '</span>' +
        '</div>';
      }).join('') + '</div>';
  }
  if (cidArmes.length) {
    html += '<div class="card mb-14"><div class="card-head"><div class="card-icon">🕵️</div><div><div class="card-title">Inventaire CID</div><div class="card-sub">' + cidArmes.length + ' RÉSULTAT(S)</div></div></div>' +
      cidArmes.map(function(w){
        return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border0);cursor:pointer" onclick="navigate(\'cid\',{id:\'' + esc(w.case_id) + '\'})">' +
          '<span class="mono text-gold" style="min-width:110px">' + esc(w.serie || '—') + '</span>' +
          '<span style="font-weight:600;color:var(--t0);flex:1">' + esc(w.nom || 'Arme') + '</span>' +
          '<span style="font-size:.8rem;color:var(--t2)">' + esc((w.case_numero || 'CID') + (w.scelle ? ' · ' + w.scelle : '')) + '</span>' +
        '</div>';
      }).join('') + '</div>';
  }
  if (mdt.length) {
    html += '<div class="card mb-14"><div class="card-head"><div class="card-icon">📚</div><div><div class="card-title">Guide MDT</div><div class="card-sub">' + mdt.length + ' PAGE(S)</div></div></div>' +
      mdt.map(function(p){ return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border0);cursor:pointer;color:var(--t0)" onclick="openMdtPageFromSearch(\'' + p.categorie_id + '\',\'' + p.id + '\')">' +
        '<span>📄</span><span style="flex:1">' + esc(p.titre) + '</span><span class="text-muted" style="font-size:.78rem">MDT →</span>' +
      '</div>'; }).join('') + '</div>';
  }
  el.innerHTML = html || '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">Aucun résultat pour "' + esc(q) + '"</div></div>';
}

async function openMdtPageFromSearch(catId, pageId) {
  _mdtSelCat = catId;
  _mdtSelPage = pageId;
  await navigate('mdt');
  await openMdtPage(pageId);
}

// ══ LOGEMENTS DE SERVICE ═════════════════════════════════════════
var _serviceLogements = [];
var _serviceAgents = [];

function serviceHousingMoney(value) {
  return (parseInt(value, 10) || 0).toLocaleString('fr-FR') + ' $';
}

function serviceLogementStatusBadge(statut) {
  var cls = statut === 'Occupé' ? 'badge-green' : (statut === 'Maintenance' ? 'badge-orange' : 'badge-blue');
  return '<span class="badge ' + cls + '">' + esc(statut || 'Libre') + '</span>';
}

function serviceLogementSetupSql() {
  return [
    "create table if not exists public.service_logements (",
    "  id uuid primary key default uuid_generate_v4(),",
    "  numero integer not null unique,",
    "  gamme text not null check (gamme in ('Haut de gamme','Bas de gamme')),",
    "  loyer integer not null,",
    "  statut text not null default 'Libre' check (statut in ('Libre','Occupé','Maintenance')),",
    "  agent_id uuid references public.agents(id) on delete set null,",
    "  occupant_nom text,",
    "  date_attribution date,",
    "  notes text,",
    "  created_at timestamp default now(),",
    "  updated_at timestamp default now()",
    ");",
    "",
    "alter table public.service_logements enable row level security;",
    "drop policy if exists service_logements_auth_all on public.service_logements;",
    "create policy service_logements_auth_all on public.service_logements for all to authenticated using (true) with check (true);",
    "",
    "create table if not exists public.service_logement_paiements (",
    "  id uuid primary key default uuid_generate_v4(),",
    "  logement_id uuid not null references public.service_logements(id) on delete cascade,",
    "  date_paiement date not null,",
    "  montant integer not null,",
    "  paye boolean not null default true,",
    "  note text,",
    "  created_at timestamp default now(),",
    "  updated_at timestamp default now(),",
    "  unique(logement_id, date_paiement)",
    ");",
    "",
    "alter table public.service_logement_paiements enable row level security;",
    "drop policy if exists service_logement_paiements_auth_all on public.service_logement_paiements;",
    "create policy service_logement_paiements_auth_all on public.service_logement_paiements for all to authenticated using (true) with check (true);",
    "",
    "insert into public.service_logements (numero, gamme, loyer)",
    "select n, 'Haut de gamme', 3500 from generate_series(1, 10) n",
    "on conflict (numero) do nothing;",
    "",
    "insert into public.service_logements (numero, gamme, loyer)",
    "select n, 'Bas de gamme', 2500 from generate_series(11, 20) n",
    "on conflict (numero) do nothing;"
  ].join('\n');
}

function serviceLogementPaiementsSetupSql() {
  return [
    "create table if not exists public.service_logement_paiements (",
    "  id uuid primary key default uuid_generate_v4(),",
    "  logement_id uuid not null references public.service_logements(id) on delete cascade,",
    "  date_paiement date not null,",
    "  montant integer not null,",
    "  paye boolean not null default true,",
    "  note text,",
    "  created_at timestamp default now(),",
    "  updated_at timestamp default now(),",
    "  unique(logement_id, date_paiement)",
    ");",
    "",
    "alter table public.service_logement_paiements enable row level security;",
    "",
    "drop policy if exists service_logement_paiements_auth_all on public.service_logement_paiements;",
    "create policy service_logement_paiements_auth_all on public.service_logement_paiements",
    "  for all to authenticated",
    "  using (true)",
    "  with check (true);"
  ].join('\n');
}

function isMissingServicePaymentsTableError(e) {
  var msg = String((e && (e.message || e.details || e.hint)) || e || '');
  return /service_logement_paiements|schema cache|Could not find the table/i.test(msg);
}

function openServicePaymentsSetup() {
  openModal({
    eyebrow: 'SUPABASE SUD',
    title: 'Initialiser l’historique paiements',
    size: 'lg',
    body:
      '<p class="text-muted" style="font-size:.86rem;margin-bottom:12px">La table des historiques de paiement n’existe pas encore. Exécute ce SQL dans Supabase Sud > SQL Editor, puis recharge la page.</p>' +
      '<textarea class="form-control" rows="16" readonly onclick="this.select()" style="font-family:monospace;font-size:.78rem">' + esc(serviceLogementPaiementsSetupSql()) + '</textarea>',
    footer: '<button class="btn btn-primary" onclick="closeModal()">OK</button>'
  });
}

function serviceDateKey(date) {
  var d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function serviceNextMondayOnOrAfter(dateStr) {
  var d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  var day = d.getDay();
  var add = (8 - day) % 7;
  d.setDate(d.getDate() + add);
  return d;
}

function buildServicePaymentHistory(logement, savedPayments) {
  var overrides = {};
  (savedPayments || []).forEach(function(p) { overrides[p.date_paiement] = p; });
  var rows = [];
  if (logement.statut === 'Occupé' && logement.date_attribution) {
    var d = serviceNextMondayOnOrAfter(logement.date_attribution);
    var today = new Date();
    today.setHours(23, 59, 59, 999);
    while (d && d <= today) {
      var key = serviceDateKey(d);
      var saved = overrides[key];
      rows.push({
        date_paiement: key,
        montant: saved ? saved.montant : logement.loyer,
        paye: saved ? !!saved.paye : true,
        auto: !saved
      });
      delete overrides[key];
      d.setDate(d.getDate() + 7);
    }
  }
  Object.keys(overrides).forEach(function(key) {
    var p = overrides[key];
    rows.push({ date_paiement: key, montant: p.montant, paye: !!p.paye, auto: false });
  });
  rows.sort(function(a, b) { return b.date_paiement.localeCompare(a.date_paiement); });
  return rows;
}

function renderServicePaymentHistory(logement, savedPayments, tableMissing) {
  if (tableMissing) {
    return '<div class="card" style="margin-top:14px;border-color:rgba(255,193,7,.45)"><div class="card-head"><div class="card-icon">$</div><div><div class="card-title">Historique paiements à initialiser</div><div class="card-sub">TABLE SUPABASE MANQUANTE</div></div></div>' +
      '<p class="text-muted" style="font-size:.84rem;margin-bottom:12px">Le calcul automatique fonctionne, mais la confirmation payé / non payé nécessite la table historique.</p>' +
      '<button class="btn btn-primary btn-sm" onclick="openServicePaymentsSetup()">Afficher le SQL</button></div>';
  }
  if (logement.statut !== 'Occupé') {
    return '<div class="card" style="margin-top:14px"><div class="card-title">Historique paiements</div><p class="text-muted" style="font-size:.82rem;margin-top:8px">Aucun historique tant que le logement n’est pas occupé.</p></div>';
  }
  if (!logement.date_attribution) {
    return '<div class="card" style="margin-top:14px"><div class="card-title">Historique paiements</div><p class="text-muted" style="font-size:.82rem;margin-top:8px">Ajoute une date d’attribution pour générer les lundis de paiement.</p></div>';
  }
  var rows = buildServicePaymentHistory(logement, savedPayments);
  var paid = rows.filter(function(r) { return r.paye; }).reduce(function(sum, r) { return sum + (parseInt(r.montant, 10) || 0); }, 0);
  var unpaid = rows.filter(function(r) { return !r.paye; }).reduce(function(sum, r) { return sum + (parseInt(r.montant, 10) || 0); }, 0);
  return '<div class="card" style="margin-top:14px;padding:0;overflow:hidden">' +
    '<div class="card-head" style="padding:14px 16px;margin:0"><div class="card-icon">$</div><div><div class="card-title">Historique paiements</div><div class="card-sub">Prélevé automatiquement chaque lundi, modifiable en cas d’impayé</div></div></div>' +
    '<div class="stats-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));padding:0 16px 14px">' +
      '<div class="stat-card"><div><div class="stat-num">' + serviceHousingMoney(paid) + '</div><div class="stat-label">TOTAL PAYÉ</div></div></div>' +
      '<div class="stat-card"><div><div class="stat-num">' + serviceHousingMoney(unpaid) + '</div><div class="stat-label">IMPAYÉ</div></div></div>' +
      '<div class="stat-card"><div><div class="stat-num">' + rows.length + '</div><div class="stat-label">LUNDIS</div></div></div>' +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>DATE</th><th>MONTANT</th><th>CONFIRMATION</th><th>ACTION</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function(r) {
        return '<tr>' +
          '<td><strong>' + esc(r.date_paiement) + '</strong>' + (r.auto ? '<div class="text-muted" style="font-size:.72rem">auto</div>' : '') + '</td>' +
          '<td>' + serviceHousingMoney(r.montant) + '</td>' +
          '<td>' + (r.paye ? '<span class="badge badge-green">Payé</span>' : '<span class="badge badge-red">Non payé</span>') + '</td>' +
          '<td><button class="btn btn-sm ' + (r.paye ? 'btn-danger' : 'btn-primary') + '" onclick="setServiceLogementPayment(\'' + logement.id + '\',\'' + r.date_paiement + '\',' + (!r.paye) + ')">' + (r.paye ? 'Mettre non payé' : 'Confirmer payé') + '</button></td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="4" class="text-muted">Aucun lundi dû pour le moment.</td></tr>') +
    '</tbody></table></div></div>';
}

function serviceHousingVisual(gamme) {
  var isHigh = gamme === 'Haut de gamme';
  var img = isHigh ? '<img src="assets/service-housing-luxury-3.png?v=20260719" alt="Appartement haut de gamme" style="display:block;width:100%;height:420px;object-fit:contain;background:#050a12">' : '<img src="assets/service-housing-safe-house.png?v=20260719" alt="Logement bas de gamme Safe House" style="display:block;width:100%;height:420px;object-fit:contain;background:#050a12">';
  var title = isHigh ? 'Luxury Housing 3' : 'Safe House';
  var price = isHigh ? '3500 $' : '2500 $';
  return '<div style="border:1px solid rgba(201,168,76,.35);border-radius:8px;overflow:hidden;background:#050a12">' +
    img +
    '<div style="padding:12px 14px;border-top:1px solid rgba(201,168,76,.22);display:flex;justify-content:space-between;gap:12px;align-items:center">' +
      '<div style="color:var(--gold);font-weight:800;font-size:.86rem;letter-spacing:.08em;text-transform:uppercase">' + title + '</div>' +
      '<div class="badge badge-gold">' + price + '</div>' +
    '</div>' +
  '</div>';
}

async function renderServiceLogements() {
  if (!isAdmin()) { toast('Accès réservé aux administrateurs.', 'error'); return; }
  _serviceAgents = visibleRosterAgents(await DB.getAgents()).filter(function(a){ return a.statut !== 'Archivé'; });
  _serviceLogements = await DB.getServiceLogements();

  if (!_serviceLogements.length) {
    setContent(
      '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Logements de service</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Table Supabase Sud non initialisée ou vide.</p></div></div>' +
      '<div class="card"><div class="card-head"><div class="card-icon">🏠</div><div><div class="card-title">Initialisation requise</div><div class="card-sub">SUPABASE SUD</div></div></div>' +
      '<p class="text-muted" style="font-size:.86rem;margin-bottom:12px">Exécute le SQL ci-dessous dans Supabase Sud > SQL Editor, puis recharge cette page.</p>' +
      '<textarea class="form-control" rows="18" readonly onclick="this.select()" style="font-family:monospace;font-size:.78rem">' + esc(serviceLogementSetupSql()) + '</textarea></div>'
    );
    return;
  }

  var occupied = _serviceLogements.filter(function(l){ return l.statut === 'Occupé'; });
  var free = _serviceLogements.filter(function(l){ return l.statut === 'Libre'; });
  var maint = _serviceLogements.filter(function(l){ return l.statut === 'Maintenance'; });
  var monthly = occupied.reduce(function(sum, l){ return sum + (parseInt(l.loyer, 10) || 0); }, 0);
  var high = _serviceLogements.filter(function(l){ return l.gamme === 'Haut de gamme'; });
  var low = _serviceLogements.filter(function(l){ return l.gamme === 'Bas de gamme'; });

  function stat(icon, title, value, sub) {
    return '<div class="stat-card"><div><div class="stat-num">' + value + '</div><div class="stat-label">' + title + '</div>' + (sub ? '<div class="text-muted" style="font-size:.76rem;margin-top:4px">' + sub + '</div>' : '') + '</div><div class="stat-ico">' + icon + '</div></div>';
  }

  function logementTable(list, title, sub) {
    return '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="card-head" style="padding:16px 18px;margin:0"><div class="card-icon">🏠</div><div style="flex:1"><div class="card-title">' + title + '</div><div class="card-sub">' + sub + '</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>#</th><th>STATUT</th><th>OCCUPANT</th><th>LOYER</th><th>ATTRIBUTION</th><th>NOTES</th><th>ACTIONS</th></tr></thead><tbody>' +
      list.map(function(l) {
        var agent = l.agent ? ((l.agent.prenom || '') + ' ' + (l.agent.nom || '')).trim() + ' (' + (l.agent.matricule || '-') + ')' : (l.occupant_nom || '-');
        return '<tr>' +
          '<td><span class="mono text-gold">L-' + String(l.numero).padStart(2, '0') + '</span></td>' +
          '<td>' + serviceLogementStatusBadge(l.statut) + '</td>' +
          '<td style="font-weight:600;color:var(--t0)">' + esc(agent) + '</td>' +
          '<td><strong>' + serviceHousingMoney(l.loyer) + '</strong><div class="text-muted" style="font-size:.72rem">prélevé lundi</div></td>' +
          '<td>' + esc(l.date_attribution || '-') + '</td>' +
          '<td class="text-muted" style="max-width:260px">' + esc(l.notes || '-') + '</td>' +
          '<td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" onclick="openServiceLogementModal(\'' + l.id + '\')">Gérer</button> ' +
            (l.statut === 'Occupé' ? '<button class="btn btn-danger btn-sm" onclick="releaseServiceLogement(\'' + l.id + '\')">Libérer</button>' : '') +
          '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8"><div><h1 style="font-size:1.4rem">Logements de service</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Gestion admin des 20 logements SASP Sud. Paiements prélevés chaque lundi.</p></div>' +
      '<button class="btn btn-primary btn-sm" onclick="openServiceHousingHelp()">Règles</button></div>' +
    '<div class="stats-grid" style="margin-bottom:18px">' +
      stat('🏠', 'Occupés', occupied.length + '/20', free.length + ' libres') +
      stat('$', 'Loyer mensuel', serviceHousingMoney(monthly), 'prélevé le lundi') +
      stat('HDG', 'Haut de gamme', high.filter(function(l){ return l.statut === 'Occupé'; }).length + '/10', '3500 $') +
      stat('BDG', 'Bas de gamme', low.filter(function(l){ return l.statut === 'Occupé'; }).length + '/10', '2500 $') +
      stat('M', 'Maintenance', maint.length, 'à suivre') +
    '</div>' +
    '<div class="page-grid2">' +
      '<div style="display:flex;flex-direction:column;gap:16px">' +
        serviceHousingVisual('Bas de gamme') +
        logementTable(low, 'Bas de gamme', '10 logements - 2500 $ / semaine') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:16px">' +
        serviceHousingVisual('Haut de gamme') +
        logementTable(high, 'Haut de gamme', '10 logements - 3500 $ / semaine') +
      '</div>' +
    '</div>'
  );
}

function openServiceHousingHelp() {
  openModal({
    eyebrow: 'LOGEMENTS DE SERVICE',
    title: 'Règles de gestion',
    size: 'sm',
    body:
      '<div style="font-size:.88rem;color:var(--t1);line-height:1.65">' +
      '<p><strong>20 logements disponibles :</strong></p>' +
      '<p>- 10 logements haut de gamme à <strong>3500 $</strong>.</p>' +
      '<p>- 10 logements bas de gamme à <strong>2500 $</strong>.</p>' +
      '<p><strong>Prélèvement :</strong> tous les lundis.</p>' +
      '<p>Statuts possibles : Libre, Occupé, Maintenance.</p>' +
      '<p>La page est accessible uniquement aux administrateurs.</p>' +
      '</div>',
    footer: '<button class="btn btn-primary" onclick="closeModal()">OK</button>'
  });
}

async function openServiceLogementModal(id) {
  var l = _serviceLogements.find(function(x){ return x.id === id; });
  if (!l) return;
  var payments = [];
  var paymentsTableMissing = false;
  try {
    payments = await DB.getServiceLogementPaiements(id);
  } catch(e) {
    payments = [];
    paymentsTableMissing = isMissingServicePaymentsTableError(e);
    if (!paymentsTableMissing) toast(e.message || e, 'error');
  }
  var agentOptions = '<option value="">- Aucun agent lié -</option>' +
    _serviceAgents.map(function(a) {
      var selected = l.agent_id === a.id ? ' selected' : '';
      return '<option value="' + a.id + '"' + selected + '>' + esc(a.matricule + ' - ' + a.prenom + ' ' + a.nom + ' - ' + a.grade) + '</option>';
    }).join('');
  openModal({
    eyebrow: 'LOGEMENT L-' + String(l.numero).padStart(2, '0'),
    title: l.gamme + ' - ' + serviceHousingMoney(l.loyer),
    size: 'md',
    body:
      '<div style="margin-bottom:16px">' + serviceHousingVisual(l.gamme) + '</div>' +
      '<div class="form-grid2">' +
        '<div class="form-group"><label class="form-label">Statut</label><select class="form-control" id="lgStatut">' +
          ['Libre','Occupé','Maintenance'].map(function(s){ return '<option value="' + s + '"' + (l.statut === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
        '</select></div>' +
        fld('Date attribution', 'date', 'lgDate', l.date_attribution || '', '') +
      '</div>' +
      '<div class="form-group"><label class="form-label">Agent lié</label><select class="form-control" id="lgAgent">' + agentOptions + '</select></div>' +
      fld('Occupant manuel', 'text', 'lgOccupant', l.occupant_nom || '', 'Si la personne n’est pas dans la base agents') +
      '<div class="form-group"><label class="form-label">Notes</label><textarea class="form-control" id="lgNotes" rows="4" placeholder="Remarques, état du logement, suivi paiement...">' + esc(l.notes || '') + '</textarea></div>' +
      renderServicePaymentHistory(l, payments, paymentsTableMissing),
    footer:
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveServiceLogement(\'' + id + '\')">Sauvegarder</button>'
  });
}

async function setServiceLogementPayment(logementId, datePaiement, paye) {
  var logement = _serviceLogements.find(function(x){ return x.id === logementId; });
  if (!logement) return;
  try {
    var r = await DB.upsertServiceLogementPaiement({
      logement_id: logementId,
      date_paiement: datePaiement,
      montant: parseInt(logement.loyer, 10) || 0,
      paye: !!paye
    });
    if (r.error) throw r.error;
    toast(paye ? 'Paiement confirmé.' : 'Paiement marqué non payé.', paye ? 'success' : 'error');
    await openServiceLogementModal(logementId);
  } catch(e) {
    if (isMissingServicePaymentsTableError(e)) {
      openServicePaymentsSetup();
      toast('Table historique paiements manquante.', 'error');
    } else {
      toast(e.message || e, 'error');
    }
  }
}

async function saveServiceLogement(id) {
  var statut = document.getElementById('lgStatut').value;
  var agentId = document.getElementById('lgAgent').value || null;
  var occupant = (document.getElementById('lgOccupant').value || '').trim();
  var data = {
    statut: statut,
    agent_id: statut === 'Occupé' ? agentId : null,
    occupant_nom: statut === 'Occupé' ? (occupant || null) : null,
    date_attribution: statut === 'Occupé' ? (document.getElementById('lgDate').value || new Date().toISOString().slice(0, 10)) : null,
    notes: (document.getElementById('lgNotes').value || '').trim() || null
  };
  if (statut === 'Occupé' && !agentId && !occupant) {
    toast('Choisis un agent ou indique un occupant manuel.', 'error');
    return;
  }
  try {
    var r = await DB.updateServiceLogement(id, data);
    if (r.error) throw r.error;
    closeModal();
    toast('Logement mis à jour.', 'success');
    await renderServiceLogements();
  } catch(e) {
    toast(e.message || e, 'error');
  }
}

async function releaseServiceLogement(id) {
  if (!confirm('Libérer ce logement ?')) return;
  try {
    var r = await DB.updateServiceLogement(id, {
      statut: 'Libre',
      agent_id: null,
      occupant_nom: null,
      date_attribution: null
    });
    if (r.error) throw r.error;
    toast('Logement libéré.', 'info');
    await renderServiceLogements();
  } catch(e) {
    toast(e.message || e, 'error');
  }
}

// ══ GLOBAL SETTINGS ═══════════════════════════════════════════════
function ticketingDefaultConfig() {
  return {
    channel_id: '1521575058500489478',
    category_id: '1501323835562000384',
    title: 'Contact Division / Unité',
    description: [
      'Vous trouverez ci-dessous les contacts des unités / divisions :',
      '',
      '• 👑 État-Major',
      '• 🎓 Police Academy',
      '• 🤝 Crisis Negotiation Unit',
      '• 🚦 Traffic Unit',
      '• 🕵️ Criminal Investigation Division',
      '• ⚔️ Special Weapons And Tactics',
      '• 🎯 Fugitive Task Force',
      '• 🤝 Syndicat',
      '• 🔒 Affaires Internes *(Pas disponible)*',
      '',
      'Sélectionnez un service dans le menu pour ouvrir une liaison privée.'
    ].join('\n'),
    image_url: 'https://louiis-hub.github.io/sasp-intranet/assets/ticket-panel-sasp.png',
    logo_url: 'https://louiis-hub.github.io/sasp-intranet/assets/sasp-sud-logo-def.png',
    footer: 'SASP - San Andreas State Trooper'
  };
}

function ticketingLoadConfig() {
  var base = ticketingDefaultConfig();
  try {
    var saved = JSON.parse(localStorage.getItem('sasp_ticketing_config') || '{}');
    return Object.assign(base, saved || {});
  } catch(e) {
    return base;
  }
}

function ticketingReadConfig() {
  return {
    channel_id: (document.getElementById('ticketChannelId') || {}).value || '',
    category_id: (document.getElementById('ticketCategoryId') || {}).value || '',
    title: (document.getElementById('ticketTitle') || {}).value || '',
    description: (document.getElementById('ticketDescription') || {}).value || '',
    image_url: (document.getElementById('ticketImageUrl') || {}).value || '',
    logo_url: 'https://louiis-hub.github.io/sasp-intranet/assets/sasp-sud-logo-def.png',
    footer: (document.getElementById('ticketFooter') || {}).value || ''
  };
}

function ticketingSaveConfig() {
  var cfg = ticketingReadConfig();
  localStorage.setItem('sasp_ticketing_config', JSON.stringify(cfg));
  toast('Configuration ticket enregistrée sur ce navigateur.', 'success');
  renderTicketingPreview();
}

function ticketingAdminCss() {
  return '<style>' +
    '.ticket-admin{max-width:1280px;margin:0 auto;padding-bottom:30px}' +
    '.ticket-admin *{box-sizing:border-box}' +
    '.tt-topbar{border:1px solid rgba(58,205,241,.75);box-shadow:0 0 0 2px rgba(58,205,241,.08),0 18px 50px rgba(0,0,0,.28);background:linear-gradient(180deg,rgba(23,34,51,.96),rgba(16,24,38,.96));border-radius:10px;padding:12px;margin-bottom:14px}' +
    '.tt-selector{display:grid;grid-template-columns:1fr 44px;gap:0;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:#31425c}' +
    '.tt-selector input{height:44px;border:0;background:#3b4d68;color:#dbeafe;padding:0 16px;font-size:.95rem;outline:none}' +
    '.tt-selector button{border:0;background:#12c878;color:white;font-weight:900;font-size:1.2rem;cursor:pointer}' +
    '.tt-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:7px;margin:10px 0 18px}' +
    '.tt-action{border:0;border-radius:4px;color:#fff;padding:9px 16px;font-weight:700;font-size:.82rem;cursor:pointer;transition:.16s transform,.16s filter}' +
    '.tt-action:hover{transform:translateY(-1px);filter:brightness(1.08)}' +
    '.tt-gray{background:#75808a}.tt-green{background:#08b86f}.tt-cyan{background:#26bfe8}.tt-blue{background:#248ad9}.tt-red{background:#ff5353}' +
    '.tt-shell{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:start}' +
    '.tt-section{background:#1e293b;border:1px solid rgba(255,255,255,.04);border-radius:9px;padding:12px;margin-bottom:10px;box-shadow:0 14px 34px rgba(0,0,0,.22)}' +
    '.tt-section-title{font-size:.9rem;font-weight:900;color:#fff;margin:0 0 12px}' +
    '.tt-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
    '.tt-tile{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;min-height:64px;width:100%;text-align:left;background:#3a4b65;border:1px solid rgba(255,255,255,.05);border-radius:6px;padding:14px 14px 12px 16px;color:#fff;transition:.16s transform,.16s background,.16s border-color;cursor:pointer;font:inherit}' +
    '.tt-tile:hover{transform:translateY(-1px);background:#435671;border-color:rgba(58,205,241,.28)}' +
    '.tt-tile strong{display:block;font-size:.96rem;line-height:1.1}' +
    '.tt-tile span{display:block;margin-top:6px;color:#aeb9c8;font-size:.72rem;line-height:1.2}' +
    '.tt-chevron{font-size:1.7rem;color:#fff;opacity:.95}' +
    '.tt-diamond{color:#ff4d5d;margin-left:4px}' +
    '.tt-config{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:2px}' +
    '.tt-config label{font-size:.7rem;color:#9fb5d0;text-transform:uppercase;letter-spacing:.08em;font-weight:800}' +
    '.tt-config .form-control,.tt-config textarea{margin-top:6px;background:#101827;border:1px solid rgba(72,103,143,.8);border-radius:6px;color:#eaf2ff}' +
    '.tt-wide{grid-column:1/-1}' +
    '.tt-side{position:sticky;top:82px}' +
    '.tt-preview-card{background:#363940;border-left:4px solid #2dd36f;border-radius:5px;padding:14px;box-shadow:0 14px 36px rgba(0,0,0,.28)}' +
    '.tt-preview-title{font-weight:900;color:#fff;margin-bottom:10px}' +
    '.tt-preview-text{white-space:pre-line;color:#f0f3f8;font-size:.88rem;line-height:1.45}' +
    '.tt-preview-img{width:100%;max-height:210px;object-fit:cover;border-radius:5px;margin-top:12px}' +
    '.tt-preview-footer{display:flex;gap:8px;align-items:center;margin-top:12px;color:#dfe6f3;font-size:.8rem}' +
    '.tt-select-preview{margin-top:12px;background:#303238;border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:12px;color:#d8dde8;display:flex;justify-content:space-between}' +
    '.tt-hint{background:rgba(14,20,32,.75);border:1px solid rgba(58,205,241,.18);border-radius:8px;color:#9fb5d0;padding:12px;margin-top:12px;font-size:.82rem;line-height:1.45}' +
    '.tt-detail{background:linear-gradient(180deg,rgba(12,20,33,.98),rgba(10,15,24,.98));border:1px solid rgba(58,205,241,.18);border-radius:8px;padding:14px;margin-top:12px}' +
    '.tt-detail .eyebrow{color:#3acdf1;margin-bottom:8px}' +
    '.tt-detail h4{margin:0 0 8px;color:#fff;font-size:1rem}' +
    '.tt-detail p{margin:0;color:#b6c6d9;font-size:.84rem;line-height:1.5}' +
    '.tt-detail button{margin-top:12px}' +
    '@media(max-width:1050px){.tt-shell{grid-template-columns:1fr}.tt-side{position:static}.tt-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
    '@media(max-width:680px){.tt-grid,.tt-config{grid-template-columns:1fr}.tt-actions{justify-content:flex-start}.ticket-admin{padding:0 4px}}' +
  '</style>';
}

function ticketingOptionTile(key, title, subtitle, premium) {
  return '<button type="button" class="tt-tile" onclick="ticketingOpenOption(\'' + escapeAttr(key) + '\')"><div><strong>' + escapeHtml(title) + (premium ? '<span class="tt-diamond">◇</span>' : '') + '</strong><span>' + escapeHtml(subtitle) + '</span></div><div class="tt-chevron">›</div></button>';
}

function ticketingSection(title, tiles) {
  return '<section class="tt-section"><h3 class="tt-section-title">' + escapeHtml(title) + '</h3><div class="tt-grid">' + tiles.join('') + '</div></section>';
}

function ticketingOpenOption(key) {
  var options = {
    general: ['General', 'Renomme le panneau et sauvegarde la configuration locale avant envoi.', 'ticketTitle'],
    category: ['Category', 'Définit la catégorie Discord où les salons privés de tickets seront créés.', 'ticketCategoryId'],
    ticket: ['Ticket', 'Définit le salon où le panneau public sera envoyé.', 'ticketChannelId'],
    moderator: ['Moderator', 'Le staff autorisé est géré par les rôles déjà configurés côté bot.'],
    permissions: ['Permissions', 'Chaque ticket est privé : utilisateur, admins, staff et rôle de division sélectionné.'],
    buttons: ['Buttons', 'Le bouton de fermeture est ajouté automatiquement dans chaque liaison privée.'],
    messages: ['Messages', 'Modifie le texte affiché dans le panneau Discord.', 'ticketDescription'],
    escalate: ['Escalate', 'Escalade non utilisée pour le moment : les tickets vont directement au staff concerné.'],
    panel: ['Panel', 'Configure le visuel principal du panneau : titre, description, image et footer.', 'ticketDescription'],
    command: ['Command Style', 'Le slash /ticket-panel reste disponible pour envoyer rapidement le panneau depuis Discord.'],
    dropdown: ['DropDown Style', 'Le menu déroulant Discord liste les divisions et ouvre la liaison privée au choix.'],
    thread: ['Thread Style', 'Le système actuel crée des salons privés, pas des threads.'],
    forms: ['Forms', 'Les formulaires avancés ne sont pas actifs : le ticket démarre via sélection de division.'],
    transcript: ['Transcript', 'Les transcripts ne sont pas encore enregistrés automatiquement.'],
    logging: ['Logging', 'Les actions importantes passent par les logs Discord existants quand le worker les déclenche.'],
    automation: ['Automation', 'Automatisation active : création du salon, permissions et fermeture via bouton.'],
    limits: ['Limits', 'Aucune limite utilisateur configurée pour le moment.'],
    claiming: ['Claiming', 'Pas de système de claim : tout le staff autorisé peut répondre.'],
    integrations: ['Integrations', 'Intégration actuelle : Discord + worker SASP Intranet.']
  };
  var item = options[key] || options.panel;
  var panel = document.getElementById('ticketOptionDetails');
  if (panel) {
    panel.innerHTML =
      '<div class="tt-detail">' +
        '<div class="eyebrow">Option sélectionnée</div>' +
        '<h4>' + escapeHtml(item[0]) + '</h4>' +
        '<p>' + escapeHtml(item[1]) + '</p>' +
        (item[2] ? '<button class="btn btn-secondary btn-sm" onclick="ticketingFocusField(\'' + escapeAttr(item[2]) + '\')">Ouvrir le réglage</button>' : '') +
      '</div>';
  }
  if (item[2]) ticketingFocusField(item[2]);
}

function ticketingFocusField(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function(){
    try { el.focus(); if (el.select) el.select(); } catch(e) {}
  }, 180);
}

function renderTicketingPreview() {
  var cfg = ticketingReadConfig();
  var preview = document.getElementById('ticketPanelPreview');
  if (!preview) return;
  preview.innerHTML =
    '<div class="tt-preview-card">' +
      '<div class="tt-preview-title">' + escapeHtml(cfg.title || 'Contact Division / Unité') + '</div>' +
      '<div class="tt-preview-text">' + escapeHtml(cfg.description || '') + '</div>' +
      (cfg.image_url ? '<img class="tt-preview-img" src="' + escapeAttr(cfg.image_url) + '" alt="">' : '') +
      '<div class="tt-preview-footer"><span>🛡️</span><strong>' + escapeHtml(cfg.footer || 'SASP - Ticketing') + '</strong></div>' +
      '<div class="tt-select-preview"><span>Fais un choix</span><span>⌄</span></div>' +
    '</div>';
}

async function renderTicketing() {
  if (!isAdmin()) { toast('Accès réservé aux administrateurs.','error'); return; }
  var cfg = ticketingLoadConfig();
  setContent(
    ticketingAdminCss() +
    '<div class="ticket-admin">' +
      '<div class="tt-topbar">' +
        '<div class="tt-selector"><input id="ticketTitle" value="' + escapeAttr(cfg.title) + '" oninput="renderTicketingPreview()" placeholder="1 | Ticket recrutement"><button onclick="ticketingSaveConfig()">+</button></div>' +
      '</div>' +
      '<div class="tt-actions">' +
        '<button class="tt-action tt-gray" onclick="toast(\'Clone réservé aux prochains panneaux multiples.\',\'info\')">Clone</button>' +
        '<button class="tt-action tt-green" onclick="ticketingSaveConfig()">Rename</button>' +
        '<button class="tt-action tt-cyan" onclick="sendTicketPanelFromSite()">Send</button>' +
        '<button class="tt-action tt-gray" onclick="toast(\'Le compteur est géré automatiquement par Discord.\',\'info\')">Set Count</button>' +
        '<button class="tt-action tt-blue" onclick="installTicketCommand()">Update</button>' +
        '<button class="tt-action tt-red" onclick="ticketingResetConfig()">Delete</button>' +
      '</div>' +
      '<div class="tt-shell">' +
        '<main>' +
          ticketingSection('General Ticket Options', [
            ticketingOptionTile('general', 'General', 'Titre et sauvegarde du panneau'),
            ticketingOptionTile('category', 'Category', 'Catégorie des tickets ouverts'),
            ticketingOptionTile('ticket', 'Ticket', 'Salon où envoyer le panneau'),
            ticketingOptionTile('moderator', 'Moderator', 'Rôles staff et modération'),
            ticketingOptionTile('permissions', 'Permissions', 'Accès privés automatiques'),
            ticketingOptionTile('buttons', 'Buttons', 'Boutons de fermeture'),
            ticketingOptionTile('messages', 'Messages', 'Texte envoyé sur Discord'),
            ticketingOptionTile('escalate', 'Escalate', 'Infos escalade')
          ]) +
          '<section class="tt-section"><h3 class="tt-section-title">Panel Settings</h3>' +
            '<div class="tt-config">' +
              '<label>Salon du panneau<input id="ticketChannelId" class="form-control" value="' + escapeAttr(cfg.channel_id) + '" placeholder="ID salon Discord"></label>' +
              '<label>Catégorie tickets<input id="ticketCategoryId" class="form-control" value="' + escapeAttr(cfg.category_id) + '" placeholder="ID catégorie Discord"></label>' +
              '<label>Image URL<input id="ticketImageUrl" class="form-control" value="' + escapeAttr(cfg.image_url) + '" oninput="renderTicketingPreview()"></label>' +
              '<label>Footer<input id="ticketFooter" class="form-control" value="' + escapeAttr(cfg.footer) + '" oninput="renderTicketingPreview()"></label>' +
              '<label class="tt-wide">Message du panneau<textarea id="ticketDescription" class="form-control" rows="10" oninput="renderTicketingPreview()">' + escapeHtml(cfg.description) + '</textarea></label>' +
            '</div>' +
            '<div class="tt-grid" style="margin-top:10px">' +
              ticketingOptionTile('panel', 'Panel', 'Message utilisé pour créer les tickets') +
              ticketingOptionTile('command', 'Command Style', 'Envoi via slash command') +
              ticketingOptionTile('dropdown', 'DropDown Style', 'Création via menu déroulant') +
              ticketingOptionTile('thread', 'Thread Style', 'Mode salons privés', true) +
              ticketingOptionTile('forms', 'Forms', 'Formulaires avancés') +
            '</div>' +
          '</section>' +
          ticketingSection('Advanced Settings', [
            ticketingOptionTile('transcript', 'Transcript', 'Sauvegarde des tickets'),
            ticketingOptionTile('logging', 'Logging', 'Logs serveur'),
            ticketingOptionTile('automation', 'Automation', 'Création et fermeture auto', true),
            ticketingOptionTile('limits', 'Limits', 'Limites et cooldowns'),
            ticketingOptionTile('claiming', 'Claiming', 'Prise en charge staff', true),
            ticketingOptionTile('integrations', 'Integrations', 'Bot Discord et worker', true)
          ]) +
        '</main>' +
        '<aside class="tt-side">' +
          '<section class="tt-section"><h3 class="tt-section-title">Live Preview</h3><div id="ticketPanelPreview"></div>' +
            '<div id="ticketOptionDetails"></div>' +
            '<div class="tt-hint">Le panneau envoyé sur Discord garde la logique actuelle : choix de division, création d’une liaison privée, permissions automatiques et bouton de fermeture.</div>' +
          '</section>' +
        '</aside>' +
      '</div>' +
    '</div>'
  );
  renderTicketingPreview();
  ticketingOpenOption('panel');
}

function ticketingResetConfig() {
  localStorage.removeItem('sasp_ticketing_config');
  toast('Configuration ticket réinitialisée.', 'info');
  renderTicketing();
}

async function installTicketCommand() {
  try {
    toast('Installation de /ticket-panel...', 'info');
    var r = await fetch(WORKER_BASE + '/admin/install-ticket-command');
    var data = await r.json().catch(function(){ return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || 'Installation impossible');
    toast('/ticket-panel installé.', 'success');
  } catch(e) {
    toast(e.message || String(e), 'error');
  }
}

async function sendTicketPanelFromSite() {
  try {
    var cfg = ticketingReadConfig();
    localStorage.setItem('sasp_ticketing_config', JSON.stringify(cfg));
    toast('Envoi du panneau tickets...', 'info');
    var r = await fetch(WORKER_BASE + '/admin/send-ticket-panel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
      body: JSON.stringify(cfg)
    });
    var data = await r.json().catch(function(){ return {}; });
    if (!r.ok || data.ok === false) throw new Error(data.error || 'Envoi impossible');
    toast('Panneau tickets envoyé.', 'success');
  } catch(e) {
    toast(e.message || String(e), 'error');
  }
}

async function renderGlobalSettings() {
  if (!isAdmin()) { toast('Accès réservé aux administrateurs.','error'); return; }
  var appUsers = await DB.getAppUsers();
  var grades   = await DB.getGrades();
  var units    = await DB.getUnits();

  function section(icon, title, sub, body) {
    return '<div class="card" style="margin-bottom:18px">' +
      '<div class="card-head"><div class="card-icon">' + icon + '</div><div>' +
        '<div class="card-title">' + title + '</div>' +
        (sub ? '<div class="card-sub">' + sub + '</div>' : '') +
      '</div></div>' + body + '</div>';
  }

  // ── Utilisateurs ──
  var usersHtml = '<div class="table-wrap"><table>' +
    '<thead><tr><th>NOM</th><th>PRÉNOM</th><th>RÔLE</th><th>CHANGER</th></tr></thead><tbody>' +
    appUsers.map(function(u) {
      return '<tr><td>' + esc(u.nom) + '</td><td>' + esc(u.prenom) + '</td>' +
        '<td>' + roleBadge(u.app_role) + '</td>' +
        '<td><select class="form-control" style="width:auto" onchange="changeRole(\'' + u.id + '\',this.value)">' +
          [['admin','Command Staff'],['academy','SASP Academy'],['agent','Agent']].map(function(p){ return '<option value="' + p[0] + '"' + (u.app_role===p[0]?' selected':'') + '>' + p[1] + '</option>'; }).join('') +
        '</select></td></tr>';
    }).join('') + '</tbody></table></div>';

  // ── Grades ──
  var gradesHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
    grades.map(function(g){
      return '<div style="display:flex;align-items:center;gap:6px;background:var(--bg1);border-radius:var(--rSm);padding:6px 12px">' +
        '<span style="font-size:.83rem;color:var(--t1);font-weight:600">' + esc(gradeLabel(g.nom)) + '</span>' +
        '<span class="mono" style="font-size:.68rem;color:var(--t3)">' + esc(g.abrev||'') + '</span>' +
        '<button class="btn btn-danger btn-sm btn-icon" style="padding:2px 6px;font-size:.7rem" onclick="deleteGradeGS(\'' + g.id + '\',\'' + esc(g.nom) + '\')">✕</button>' +
      '</div>';
    }).join('') + '</div>' +
    '<button class="btn btn-outline btn-sm" onclick="navigate(\'grades\')">✏️ Gérer les grades</button>';

  // ── Unités ──
  var unitsHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">' +
    units.map(function(u){
      return '<div style="display:flex;align-items:center;gap:6px;background:var(--bg1);border-radius:var(--rSm);padding:6px 12px">' +
        '<span class="mono text-gold" style="font-size:.8rem;font-weight:700">' + esc(u.code) + '</span>' +
        '<span style="font-size:.8rem;color:var(--t2)">' + esc(u.nom) + '</span>' +
        '<button class="btn btn-danger btn-sm btn-icon" style="padding:2px 6px;font-size:.7rem" onclick="deleteUnitGS(\'' + u.id + '\',\'' + esc(u.code) + '\')">✕</button>' +
      '</div>';
    }).join('') + '</div>' +
    '<button class="btn btn-outline btn-sm" onclick="navigate(\'units\')">✏️ Gérer les divisions</button>';

  // ── Permissions ──
  var cfg = {};
  try { cfg = JSON.parse(localStorage.getItem('sasp_permissions') || '{}'); } catch(e) {}

  var allPages = [
    { id:'dashboard',     label:'Tableau de bord' },
    { id:'agents',        label:'Agents' },
    { id:'grades',        label:'Grades' },
    { id:'units',         label:'Divisions' },
    { id:'mdt',           label:'Guide MDT' },
    { id:'vehicles',      label:'Véhicules' },
    { id:'info',          label:'Informations' },
    { id:'manuel',        label:'Manuel' },
    { id:'tenue',         label:'Tenues' },
    { id:'document',      label:'Documents' },
    { id:'stats',         label:'Statistiques', staffDefault:true },
    { id:'search',        label:'Recherche',    staffDefault:true }
  ];
  var agentPages   = cfg.agentPages   || ['dashboard','agents','agent-profile','grades','units','mdt','vehicles','info','manuel','tenue','document'];
  var academyPages = cfg.academyPages  || allPages.map(function(p){ return p.id; });

  var permHtml =
    '<div style="font-size:.82rem;margin-bottom:16px;color:var(--t2)">IDs des rôles Discord utilisés pour l\'authentification.</div>' +
    '<div style="display:grid;grid-template-columns:1fr 2fr;gap:10px 16px;align-items:center;margin-bottom:20px">' +
      '<label style="font-size:.82rem;font-weight:600;color:var(--gold)">🔴 Command Staff</label>' +
      '<input class="form-control" id="cfgAdminId" value="' + esc((cfg.roleAdminIds || ROLE_ADMIN_IDS).join(', ')) + '" placeholder="ID1, ID2">' +
      '<label style="font-size:.82rem;font-weight:600;color:var(--blue)">🔵 SASP Academy</label>' +
      '<input class="form-control" id="cfgAcademyId" value="' + esc(cfg.roleAcademyId || ROLE_ACADEMY_ID) + '">' +
      '<label style="font-size:.82rem;font-weight:600;color:var(--t2)">⚪ Agent</label>' +
      '<input class="form-control" id="cfgAgentId" value="' + esc(cfg.roleAgentId || ROLE_AGENT_ID) + '">' +
    '</div>' +
    '<div style="font-size:.82rem;font-weight:600;color:var(--t1);margin-bottom:10px">Accès aux pages par rôle</div>' +
    '<div class="table-wrap"><table>' +
      '<thead><tr><th>PAGE</th><th style="text-align:center">Agent</th><th style="text-align:center">Académie</th><th style="text-align:center">Admin</th></tr></thead>' +
      '<tbody>' +
        allPages.map(function(p) {
          var agChk  = agentPages.indexOf(p.id) !== -1;
          var acChk  = academyPages.indexOf(p.id) !== -1;
          return '<tr>' +
            '<td style="font-size:.82rem">' + p.label + '</td>' +
            '<td style="text-align:center"><input type="checkbox" id="perm_agent_' + p.id + '"' + (agChk?' checked':'') + (p.staffDefault?' disabled':'') + '></td>' +
            '<td style="text-align:center"><input type="checkbox" id="perm_academy_' + p.id + '"' + (acChk?' checked':'') + (p.staffDefault?' disabled':'') + '></td>' +
            '<td style="text-align:center"><input type="checkbox" checked disabled></td>' +
          '</tr>';
        }).join('') +
      '</tbody>' +
    '</table></div>' +
    '<div style="margin-top:14px"><button class="btn btn-primary btn-sm" onclick="savePermissions()">💾 Sauvegarder les permissions</button></div>';

  // ── Sections Documentation ──
  var docsHtml =
    '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">' +
    _wikiSections.map(function(s) {
      return '<div style="display:flex;align-items:center;gap:10px;background:var(--bg1);border-radius:var(--rSm);padding:8px 12px">' +
        '<span style="font-size:1rem">' + (s.icon||'📄') + '</span>' +
        '<span style="font-size:.85rem;font-weight:600;color:var(--t1);flex:1">' + esc(s.titre) + '</span>' +
        '<span style="font-size:.75rem;color:var(--t3)">' + esc(s.sous_titre||'') + '</span>' +
        (s._default ? '' :
          '<button class="btn btn-ghost btn-sm btn-icon" style="color:var(--red)" onclick="deleteDocSection(\'' + s.id + '\',\'' + esc(s.titre) + '\')">✕</button>') +
      '</div>';
    }).join('') +
    '</div>' +
    '<button class="btn btn-outline btn-sm" onclick="openDocSectionModal()">+ Nouvelle section</button>';

  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Réglages globaux</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Configuration générale du site — accès admin uniquement</p></div></div>' +
    section('👥', 'Gestion des accès', 'RÔLES DES UTILISATEURS', usersHtml) +
    section('🎖️', 'Grades', 'HIÉRARCHIE', gradesHtml) +
    section('🚔', 'Divisions', 'UNITÉS DE LA SASP', unitsHtml) +
    section('📚', 'Documentation', 'SECTIONS DU MENU', docsHtml) +
    section('🔐', 'Permissions & Rôles Discord', 'CONTRÔLE D\'ACCÈS', permHtml)
  );
}
function openDocSectionModal() {
  var icons = ['📄','📋','📁','📑','📊','🗂️','📰','🔖','📝','⚖️','🛡️','🚨','🏆','🗒️'];
  openModal({
    eyebrow: 'DOCUMENTATION',
    title: 'Nouvelle section',
    size: 'sm',
    body:
      fld('Titre *','text','docSecTitre','','Ex : Procédures internes') +
      fld('Sous-titre','text','docSecSub','','Ex : Règles et protocoles') +
      '<div class="form-group"><label class="form-label">Icône</label>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
          icons.map(function(ic){ return '<button type="button" onclick="selectDocIcon(\'' + ic + '\')" style="font-size:1.3rem;background:var(--bg1);border:1px solid var(--border0);border-radius:var(--rSm);padding:4px 8px;cursor:pointer" id="dico_' + encodeURIComponent(ic) + '">' + ic + '</button>'; }).join('') +
        '</div>' +
        '<input type="hidden" id="docSecIcon" value="📄">' +
      '</div>',
    footer: '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="createDocSection()">Créer</button>'
  });
}
function selectDocIcon(ic) {
  document.getElementById('docSecIcon').value = ic;
  document.querySelectorAll('[id^="dico_"]').forEach(function(b){ b.style.borderColor = 'var(--border0)'; b.style.background = 'var(--bg1)'; });
  var btn = document.getElementById('dico_' + encodeURIComponent(ic));
  if (btn) { btn.style.borderColor = 'var(--blue)'; btn.style.background = 'var(--bg2)'; }
}
async function createDocSection() {
  var titre = (document.getElementById('docSecTitre').value || '').trim();
  if (!titre) { toast('Titre requis.','error'); return; }
  var slug = titre.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  var data = {
    slug: slug,
    titre: titre,
    sous_titre: (document.getElementById('docSecSub').value || '').trim(),
    icon: document.getElementById('docSecIcon').value || '📄',
    ordre: _wikiSections.length
  };
  try {
    var r = await DB.createWikiSection(data);
    if (r.error) throw r.error;
    closeModal(); toast('Section créée.','success');
    await loadWikiSections();
    await renderGlobalSettings();
  } catch(e) { toast(e.message,'error'); }
}
async function deleteDocSection(id, nom) {
  if (!confirm('Supprimer la section "' + nom + '" et toutes ses pages ?')) return;
  try {
    var r = await DB.deleteWikiSection(id);
    if (r.error) throw r.error;
    toast('Section supprimée.','info');
    await loadWikiSections();
    await renderGlobalSettings();
  } catch(e) { toast(e.message,'error'); }
}

function savePermissions() {
  var allPageIds = ['dashboard','agents','grades','units','mdt','vehicles','info','manuel','tenue','document','stats','search'];
  var agentPages   = allPageIds.filter(function(id){ var el = document.getElementById('perm_agent_'   + id); return el && !el.disabled && el.checked; });
  var academyPages = allPageIds.filter(function(id){ var el = document.getElementById('perm_academy_' + id); return el && !el.disabled && el.checked; });
  var adminRaw = document.getElementById('cfgAdminId').value;
  var cfg = {
    roleAdminIds:  adminRaw.split(',').map(function(s){ return s.trim(); }).filter(Boolean),
    roleAcademyId: document.getElementById('cfgAcademyId').value.trim(),
    roleAgentId:   document.getElementById('cfgAgentId').value.trim(),
    agentPages:    agentPages.concat(['agent-profile']),
    academyPages:  academyPages.concat(['agent-profile'])
  };
  localStorage.setItem('sasp_permissions', JSON.stringify(cfg));
  ROLE_ADMIN_IDS  = cfg.roleAdminIds;
  ROLE_ACADEMY_ID = cfg.roleAcademyId;
  ROLE_AGENT_ID   = cfg.roleAgentId;
  toast('Permissions sauvegardées — rechargez pour appliquer les rôles.', 'success');
}

async function deleteGradeGS(id, nom) {
  if (!confirm('Supprimer le grade "' + nom + '" ?\nAttention : les agents ayant ce grade devront être mis à jour manuellement.')) return;
  var r = await DB.deleteGrade(id);
  if (r.error) { toast(r.error.message, 'error'); return; }
  toast('Grade supprimé.', 'info');
  renderGlobalSettings();
}
async function deleteUnitGS(id, code) {
  if (!confirm('Supprimer la division "' + code + '" ?')) return;
  var r = await DB.deleteUnit(id);
  if (r.error) { toast(r.error.message, 'error'); return; }
  toast('Division supprimée.', 'info');
  renderGlobalSettings();
}
async function purgeAllArchives() {
  toast('La page Archives est desactivee.', 'info');
  return;
  var archived = await DB.getArchivedAgents('');
  if (!archived.length) { toast('Aucune archive à purger.', 'info'); return; }
  if (!confirm('Supprimer définitivement les ' + archived.length + ' agent(s) archivé(s) ?\n\nCette action est IRRÉVERSIBLE.')) return;
  var errors = [];
  for (var i = 0; i < archived.length; i++) {
    var r = await DB.deleteAgent(archived[i].id);
    if (r.error) errors.push(archived[i].nom);
  }
  if (errors.length) toast('Erreur sur : ' + errors.join(', '), 'error');
  else toast('Toutes les archives ont été supprimées.', 'success');
  renderGlobalSettings();
}

// ══ SETTINGS ══════════════════════════════════════════════════════
async function renderSettings() {
  var appUsers = isAdmin() ? await DB.getAppUsers() : [];
  var me = S.appUser;
  var discordName = S.user && S.user.user_metadata && (S.user.user_metadata.full_name || S.user.user_metadata.name || S.user.user_metadata.user_name);
  var displayName = discordName || (S.user ? S.user.email : '—');

  var usersHtml = '';
  if (isAdmin() && appUsers.length) {
    usersHtml = '<div class="card mt-18">' +
      '<div class="card-head"><div class="card-icon">👥</div><div><div class="card-title">Utilisateurs</div><div class="card-sub">GESTION DES ACCÈS</div></div></div>' +
      '<div class="table-wrap"><table><thead><tr><th>NOM</th><th>PRÉNOM</th><th>RÔLE</th><th>ACTIONS</th></tr></thead><tbody>' +
      appUsers.map(function(u) {
        return '<tr><td>' + esc(u.nom) + '</td><td>' + esc(u.prenom) + '</td>' +
          '<td>' + roleBadge(u.app_role) + '</td>' +
          '<td><select class="form-control" style="width:auto" onchange="changeRole(\'' + u.id + '\',this.value)">' +
            [['admin','Command Staff'],['academy','SASP Academy'],['agent','Agent']].map(function(p){ return '<option value="' + p[0] + '"' + (u.app_role===p[0]?' selected':'') + '>' + p[1] + '</option>'; }).join('') +
          '</select></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
    '</div>';
  }

  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Mon compte</h1></div></div>' +
    '<div class="card">' +
      '<div class="card-head"><div class="card-icon">👤</div><div><div class="card-title">Informations</div></div></div>' +
      infoRow('Discord', displayName) +
      infoRow('Pseudo serveur', S.serverNick || '—') +
      infoRow('Nom', me ? (me.prenom + ' ' + me.nom).trim() || '—' : '—') +
      infoRow('Rôle', roleBadge(S.role)) +
    '</div>' +
    '<div class="card" style="margin-top:18px">' +
      '<div class="card-head"><div class="card-icon">🔒</div><div><div class="card-title">Session</div></div></div>' +
      '<p class="text-muted" style="font-size:.84rem;margin-bottom:14px">L\'accès est géré via les rôles Discord. Les permissions sont mises à jour automatiquement à chaque connexion.</p>' +
      '<button class="btn btn-danger btn-sm" onclick="doLogout()">⏻ Se déconnecter</button>' +
    '</div>' +
    (isAdmin() ? '<div class="card" style="margin-top:18px"><p class="text-muted" style="font-size:.82rem">👉 Administration complète dans <a onclick="navigate(\'global-settings\')" style="color:var(--blue);cursor:pointer">Réglages globaux</a>.</p></div>' : '')
  );
}

function roleBadge(r) {
  var map = { admin:'badge-gold', academy:'badge-blue', agent:'badge-gray' };
  var labels = { admin:'Command Staff', academy:'SASP Academy', agent:'Agent' };
  return '<span class="badge ' + (map[r]||'badge-gray') + '">' + esc(labels[r]||r) + '</span>';
}

// ══ POINTEUSE ══════════════════════════════════════════════════════
var _pointageActifs = {};

function pointeuseRelativeTime(targetIso, suffix) {
  if (!targetIso) return '—';
  var diff = new Date(targetIso).getTime() - Date.now();
  var past = diff < 0;
  var abs = Math.abs(diff);
  var h = Math.floor(abs / 3600000);
  var m = Math.floor((abs % 3600000) / 60000);
  var value = h > 0 ? h + 'h' + (m < 10 ? '0' : '') + m : m + ' min';
  return past ? 'maintenant' : value + (suffix || '');
}

function pointeuseStatusHtml(actif) {
  if (!actif) return '<span class="badge badge-gray">Hors service</span>';
  var since = fmtDuration(actif.clock_in);
  if (actif.confirmation_requested_at) {
    return '<div class="pointeuse-status">' +
      '<span class="badge badge-gold">Confirmation demandée</span>' +
      '<small>En service depuis ' + esc(since) + '</small>' +
    '</div>';
  }
  return '<div class="pointeuse-status">' +
    '<span class="badge badge-green">En service · ' + esc(since) + '</span>' +
    '<small>Surveillance automatique active</small>' +
  '</div>';
}

function pointeuseFollowupHtml(actif) {
  if (!actif) return '<span style="color:var(--t3)">—</span>';
  var parts = [];
  if (actif.confirmation_requested_at) {
    parts.push('<div><strong style="color:var(--gold)">Réponse attendue</strong><span>Demande envoyée à ' + fmtClock(actif.confirmation_requested_at) + '</span></div>');
    parts.push('<div><strong>Délai auto</strong><span>15 min après la demande</span></div>');
  } else if (actif.next_confirmation_at) {
    parts.push('<div><strong>Prochaine vérif.</strong><span>' + fmtClock(actif.next_confirmation_at) + ' · dans ' + pointeuseRelativeTime(actif.next_confirmation_at) + '</span></div>');
  } else {
    parts.push('<div><strong>Prochaine vérif.</strong><span>Après 5h de service</span></div>');
  }
  if (actif.last_confirmation_at) {
    parts.push('<div><strong>Dernière confirmation</strong><span>' + fmtClock(actif.last_confirmation_at) + ' · ' + fmt(actif.last_confirmation_at) + '</span></div>');
  }
  parts.push('<div><strong>Confirmations</strong><span>' + Number(actif.confirmation_count || 0) + '</span></div>');
  return '<div class="pointeuse-followup">' + parts.join('') + '</div>';
}

async function renderPointeuse() {
  var _today = new Date();
  var _dow = _today.getDay();
  var _monday = new Date(_today);
  _monday.setDate(_today.getDate() - (_dow === 0 ? 6 : _dow - 1));
  _monday.setHours(0, 0, 0, 0);

  var [agents, pointages, rapport] = await Promise.all([
    DB.getAgents(),
    DB.getActivePointages(),
    DB.getPointageReport(_monday.toISOString())
  ]);
  _pointageActifs = {};
  pointages.forEach(function(p) { _pointageActifs[p.agent_id] = p; });
  var enService = pointages.length;
  var lastByAgent = {};
  var lastClosedByAgent = {};
  rapport.forEach(function(p) {
    if (!lastByAgent[p.agent_id]) lastByAgent[p.agent_id] = p;
    if (p.clock_out && !lastClosedByAgent[p.agent_id]) lastClosedByAgent[p.agent_id] = p;
  });

  var rows = agents.map(function(a) {
    var actif = _pointageActifs[a.id];
    var last = lastByAgent[a.id];
    var lastClosed = lastClosedByAgent[a.id];
    var priseHtml = actif
      ? '<strong class="text-gold">' + fmtClock(actif.clock_in) + '</strong><br><small style="color:var(--t3)">' + fmt(actif.clock_in) + '</small>'
      : (last ? '<span>' + fmtClock(last.clock_in) + '</span><br><small style="color:var(--t3)">' + fmt(last.clock_in) + '</small>' : '<span style="color:var(--t3)">—</span>');
    var finHtml = actif
      ? '<span class="badge badge-green">En cours</span>'
      : (lastClosed ? '<span>' + fmtClock(lastClosed.clock_out) + '</span><br><small style="color:var(--t3)">' + fmt(lastClosed.clock_out) + '</small>' : '<span style="color:var(--t3)">—</span>');
    var statusHtml = pointeuseStatusHtml(actif);
    var followupHtml = pointeuseFollowupHtml(actif);
    var forceBtn = (actif && canWrite())
      ? ' <button class="btn btn-ghost btn-sm" style="color:#e74c3c;border-color:rgba(231,76,60,.3)" onclick="forceClockOut(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.matricule) + '\')" title="Forcer fin de service">Forcer</button>'
      : '';
    var btnHtml = actif
      ? '<button class="btn btn-danger btn-sm" onclick="doClockOut(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.matricule) + '\')">⏹ Sortie</button>' + forceBtn
      : '<button class="btn btn-primary btn-sm" onclick="doClockIn(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.matricule) + '\')">▶ Entrée</button>';
    var telephone = fmtTel(a.telephone) || '';
    var telephoneCell = telephone
      ? '<div style="display:flex;align-items:center;gap:6px;white-space:nowrap"><code style="font-family:monospace;font-size:.8rem;color:var(--t2)">' + esc(telephone) + '</code><button class="btn btn-ghost btn-sm" title="Copier le telephone" onclick="event.stopPropagation();copyTelephone(\'' + jsStr(telephone) + '\')">Copier</button></div>'
      : '<span style="font-family:monospace;font-size:.8rem;color:var(--t3)">-</span>';
    return '<tr>' +
      '<td>' + gradeBadge(a.grade) + '</td>' +
      '<td><strong>' + esc(a.prenom + ' ' + a.nom) + '</strong><br><small style="color:var(--t3)">' + esc(a.matricule) + '</small></td>' +
      '<td>' + telephoneCell + '</td>' +
      '<td>' + statusHtml + '</td>' +
      '<td>' + priseHtml + '</td>' +
      '<td>' + followupHtml + '</td>' +
      '<td>' + finHtml + '</td>' +
      '<td>' + btnHtml + '</td>' +
    '</tr>';
  }).join('');

  // ── Rapport staff ──────────────────────────────────────────────
  var rapportHtml = '';
  if (canWrite() && rapport.length) {
    // Grouper par agent + jour
    var byAgentDay = {};
    rapport.forEach(function(p) {
      var key = p.agent_id;
      var day = p.clock_in.slice(0, 10);
      var sec = p.clock_out ? Math.floor((new Date(p.clock_out) - new Date(p.clock_in)) / 1000) : 0;
      if (!byAgentDay[key]) byAgentDay[key] = { agent: p.agents, days: {} };
      byAgentDay[key].days[day] = (byAgentDay[key].days[day] || 0) + sec;
    });

    // Lundi → Dimanche de la semaine en cours
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(_monday.getTime() + i * 86400000);
      days.push(d.toISOString().slice(0, 10));
    }

    var rapportRows = Object.entries(byAgentDay).sort(function(a, b) {
      return parseInt(a[1].agent.matricule || 999) - parseInt(b[1].agent.matricule || 999);
    }).map(function(kv) {
      var agentId = kv[0];
      var entry = kv[1];
      var a = entry.agent || {};
      var totalSec = 0;
      var cells = days.map(function(day) {
        var sec = entry.days[day] || 0;
        totalSec += sec;
        return '<td style="text-align:center">' + (sec ? fmtSec(sec) : '<span style="color:var(--t3)">—</span>') + '</td>';
      }).join('');
      var salaire = calcSalaire(a.grade, totalSec);
      var delBtn = isAdmin()
        ? '<td style="text-align:center"><button class="btn btn-ghost btn-sm" style="color:#e74c3c;padding:2px 7px" onclick="deleteAgentRecap(\'' + agentId + '\',\'' + esc((a.prenom||'')+' '+(a.nom||'')) + '\')" title="Supprimer les pointages de cet agent">🗑️</button></td>'
        : '<td></td>';
      return '<tr>' +
        '<td><strong>' + esc((a.prenom || '') + ' ' + (a.nom || '')) + '</strong><br><small style="color:var(--t3)">' + esc(a.matricule || '') + '</small></td>' +
        cells +
        '<td style="text-align:center"><strong>' + fmtSec(totalSec) + '</strong></td>' +
        '<td style="text-align:center;color:var(--gold);font-weight:700">' + fmtMoney(salaire) + '</td>' +
        delBtn +
      '</tr>';
    }).join('');

    var dayHeaders = days.map(function(d) {
      var dt = new Date(d + 'T12:00:00');
      return '<th style="text-align:center;font-size:.75rem">' + dt.toLocaleDateString('fr-FR', { weekday:'short', day:'2-digit', month:'2-digit' }) + '</th>';
    }).join('');

    var resetBtn = isAdmin()
      ? '<button class="btn btn-danger btn-sm" onclick="resetPointageRecap()">🗑️ Réinitialiser</button>'
      : '';
    rapportHtml = '<div class="card" style="margin-top:18px">' +
      '<div class="card-head"><div class="card-icon">📊</div><div>' +
        '<div class="card-title">Récapitulatif — semaine en cours</div>' +
        '<div class="card-sub">HEURES PAR AGENT ET PAR JOUR</div>' +
      '</div>' + resetBtn + '</div>' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>AGENT</th>' + dayHeaders + '<th style="text-align:center">TOTAL</th><th style="text-align:center">SALAIRE</th><th></th></tr></thead>' +
        '<tbody>' + rapportRows + '</tbody>' +
      '</table></div>' +
    '</div>';
  } else if (canWrite()) {
    rapportHtml = '<div class="card" style="margin-top:18px"><p class="text-muted" style="padding:12px">Aucun pointage enregistré sur les 7 derniers jours.</p></div>';
  }

  var histBtn = canWrite()
    ? '<button class="btn btn-ghost btn-sm" onclick="navigate(\'pointeuse-historique\')">📜 Historique</button>'
    : '';

  setContent(
    '<div class="flex-between mb-20">' +
      '<div><h1 style="font-size:1.4rem">Pointeuse</h1>' +
      '<p class="text-muted">' + enService + ' agent' + (enService > 1 ? 's' : '') + ' en service</p></div>' +
      histBtn +
    '</div>' +
    '<div class="card">' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>GRADE</th><th>AGENT</th><th>TELEPHONE</th><th>STATUT</th><th>PRISE SERVICE</th><th>SUIVI AUTO</th><th>FIN SERVICE</th><th>ACTION</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="8" style="text-align:center;color:var(--t3)">Aucun agent</td></tr>') + '</tbody>' +
      '</table></div>' +
    '</div>' +
    rapportHtml
  );
}

function resetPointageRecap() {
  openModal({
    eyebrow: 'POINTEUSE', title: 'Réinitialiser le récap ?',
    body: '<p style="color:var(--t1)">Tous les pointages de la semaine en cours seront supprimés définitivement.</p>',
    footer: '<button class="btn btn-ghost btn-sm" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-danger btn-sm" onclick="confirmResetRecap()">Supprimer</button>'
  });
}

async function confirmResetRecap() {
  closeModal();
  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  var { error } = await DB.deletePointagesSince(monday.toISOString());
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast('Récap réinitialisé', 'success');
  refreshPointeuseDiscordMessage();
  await renderPointeuse();
}

function forceClockOut(agentId, agentName, matricule) {
  openModal({
    eyebrow: 'POINTEUSE', title: 'Forcer la sortie ?',
    body: '<p style="color:var(--t1)">Forcer la fin de service de <strong>' + esc(agentName) + '</strong> (' + esc(matricule) + ') ?</p>',
    footer: '<button class="btn btn-ghost btn-sm" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-danger btn-sm" onclick="closeModal();doClockOut(\'' + agentId + '\',\'' + agentName.replace(/'/g,"\\'") + '\',\'' + matricule + '\')">Forcer</button>'
  });
}

function deleteAgentRecap(agentId, agentName) {
  openModal({
    eyebrow: 'POINTEUSE', title: 'Supprimer les pointages ?',
    body: '<p style="color:var(--t1)">Supprimer tous les pointages de <strong>' + esc(agentName.trim()) + '</strong> sur la semaine en cours ?</p>',
    footer: '<button class="btn btn-ghost btn-sm" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-danger btn-sm" onclick="confirmDeleteAgentRecap(\'' + agentId + '\')">Supprimer</button>'
  });
}

async function confirmDeleteAgentRecap(agentId) {
  closeModal();
  var today = new Date();
  var dow = today.getDay();
  var monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);
  var { error } = await DB.deletePointagesForAgent(agentId, monday.toISOString());
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast('Pointages supprimés', 'success');
  await renderPointeuse();
}

async function doClockIn(agentId, agentName, matricule) {
  var res = await DB.clockIn(agentId);
  var error = res.error;
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  if (res.alreadyActive) { toast('Tu es déjà en service.', 'info'); await renderPointeuse(); return; }
  toast('Entrée enregistrée', 'success');
  sendLog('🟢 Prise de service', 0x27ae60, [
    { name: 'Agent', value: (agentName || '—') + (matricule ? ' · ' + matricule : ''), inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  refreshPointeuseDiscordMessage();
  await renderPointeuse();
}

async function doClockOut(agentId, agentName, matricule) {
  var p = _pointageActifs[agentId];
  if (!p) return;
  var { error } = await DB.clockOutActiveForAgent(agentId);
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast('Sortie enregistrée', 'success');
  sendLog('🔴 Fin de service', 0x7f8c8d, [
    { name: 'Agent', value: (agentName || '—') + (matricule ? ' · ' + matricule : ''), inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  refreshPointeuseDiscordMessage();
  await renderPointeuse();
}

// ══ CÉRÉMONIE ═════════════════════════════════════════════════════

function _myDiscordId() {
  if (!S.user) return null;
  var identity = S.user.identities && S.user.identities.find(function(i){ return i.provider === 'discord'; });
  return (identity && (identity.id || (identity.identity_data && identity.identity_data.sub))) ||
         (S.user.user_metadata && S.user.user_metadata.provider_id) || null;
}

function ceremonieVoterId() {
  var discordId = _myDiscordId();
  if (discordId) return String(discordId);
  if (S.user && S.user.id) return 'site:' + S.user.id;
  var key = 'sasp_ceremonie_voter_id';
  var stored = '';
  try { stored = localStorage.getItem(key) || ''; } catch(e) {}
  if (!stored) {
    stored = 'pin:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem(key, stored); } catch(e) {}
  }
  return stored;
}

function isCeremonieVoteLockedGrade(grade) {
  var key = gradeKey(grade);
  return key === 'chief' || key === 'commandant' || key === 'capitaine';
}

async function renderCeremonie() {
  var [agents, votes, archives] = await Promise.all([
    DB.getAgents(),
    DB.getCeremonieVotes(),
    DB.getCeremonieArchives().catch(function(){ return []; })
  ]);
  var votesByAgent = {};
  votes.forEach(function(v) {
    if (!votesByAgent[v.agent_id]) votesByAgent[v.agent_id] = [];
    votesByAgent[v.agent_id].push(v);
  });
  var myId = ceremonieVoterId();
  var isCmd = S.role === 'admin';
  _ceremonieArchives = archives || [];

  var sorted = agents.slice().sort(function(a, b) {
    var ma = parseInt(String(a.matricule || '999').replace(/\D/g, ''), 10);
    var mb = parseInt(String(b.matricule || '999').replace(/\D/g, ''), 10);
    if (isNaN(ma)) ma = 999;
    if (isNaN(mb)) mb = 999;
    return ma - mb || String(a.matricule || '').localeCompare(String(b.matricule || ''), 'fr', { numeric: true });
  });

  // Débrief (admin uniquement)
  var debriefHtml = '';
  if (isCmd) {
    var uPromo = [], uRetro = [], contested = [];
    sorted.forEach(function(a) {
      var av = votesByAgent[a.id] || [];
      if (!av.length) return;
      var p = av.filter(function(v){ return v.decision === 'promotion'; }).length;
      var r = av.filter(function(v){ return v.decision === 'retrogradation'; }).length;
      if (p === av.length) uPromo.push(a);
      else if (r === av.length) uRetro.push(a);
      else contested.push(a);
    });
    var stat = function(count, color, icon, label, names) {
      return '<div style="text-align:center;padding:14px 10px;background:' + color + ';border-radius:8px">' +
        '<div style="font-size:1.5rem;font-weight:800">' + count + '</div>' +
        '<div style="font-size:.7rem;color:var(--t2);margin-top:3px">' + icon + ' ' + label + '</div>' +
        (names.length ? '<div style="font-size:.68rem;color:var(--t3);margin-top:5px">' + names.map(function(a){ return esc(a.prenom+' '+a.nom); }).join(', ') + '</div>' : '') +
      '</div>';
    };
    debriefHtml = '<div class="card" style="margin-bottom:18px">' +
      '<div class="card-head"><div class="card-icon">📊</div><div><div class="card-title">Débrief session</div></div>' +
      (isCmd ? '<button class="btn btn-ghost btn-sm" onclick="resetCeremonieVotes()" style="color:#e74c3c">🗑️ Reset votes</button>' : '') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">' +
        stat(uPromo.length, 'rgba(46,204,113,.08)', '📈', 'PROMOTIONS UNANIMES', uPromo) +
        stat(uRetro.length, 'rgba(231,76,60,.08)',  '📉', 'RÉTROGRADATIONS UNANIMES', uRetro) +
        stat(contested.length, 'rgba(243,156,18,.08)', '⚠️', 'À DISCUTER', contested) +
      '</div>' +
    '</div>';
  }

  var archivesHtml = '';
  if (isCmd) {
    archivesHtml = '<div class="card" style="margin-top:18px">' +
      '<div class="card-head"><div class="card-icon">🗃️</div><div><div class="card-title">Archives des resets</div><div class="card-sub">Dernières sessions sauvegardées</div></div></div>' +
      ((archives || []).length
        ? '<div class="table-wrap"><table><thead><tr><th>DATE</th><th>VOTES</th><th>PROMOTIONS</th><th>RÉTROGRADATIONS</th><th>À DISCUTER</th><th>PAR</th><th>ACTIONS</th></tr></thead><tbody>' +
          archives.map(function(ar) {
            var s = ar.summary || {};
            return '<tr style="cursor:pointer" onclick="openCeremonieArchive(\'' + esc(ar.id) + '\')">' +
              '<td><strong>' + esc(ar.session_label || fmt(ar.created_at)) + '</strong><br><small style="color:var(--t3)">Cliquer pour voir le détail · ' + esc(fmt(ar.created_at)) + '</small></td>' +
              '<td>' + esc(ar.votes_count || 0) + '</td>' +
              '<td><span class="badge" style="background:rgba(46,204,113,.15);color:#2ecc71;border:1px solid rgba(46,204,113,.3)">' + esc(s.promotions_unanimes || 0) + '</span></td>' +
              '<td><span class="badge badge-red">' + esc(s.retrogradations_unanimes || 0) + '</span></td>' +
              '<td><span class="badge badge-gray">' + esc(s.a_discuter || 0) + '</span></td>' +
              '<td>' + esc(ar.archived_by || '—') + '</td>' +
              '<td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openCeremonieArchive(\'' + esc(ar.id) + '\')">👁️ Voir</button> ' +
                '<button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteCeremonieArchive(\'' + esc(ar.id) + '\')">🗑️ Supprimer</button></td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>'
        : '<div class="empty-state" style="padding:24px"><div class="empty-icon">🗃️</div><div class="empty-title">Aucune archive</div><div class="empty-sub">Le prochain reset sauvegardera la session ici.</div></div>') +
    '</div>';
  }

  // Lignes agents
  var rows = sorted.map(function(a) {
    var av = votesByAgent[a.id] || [];
    var myVote = av.find(function(v){ return v.voter_discord_id === myId; });
    var voteLocked = isCeremonieVoteLockedGrade(a.grade);

    var myVoteHtml = myVote
      ? (myVote.decision === 'promotion'
          ? '<span class="badge" style="background:rgba(46,204,113,.15);color:#2ecc71;border:1px solid rgba(46,204,113,.3)">📈 Promotion</span>'
          : myVote.decision === 'maintien'
            ? '<span class="badge badge-gray">➡️ Maintien</span>'
            : '<span class="badge badge-red">📉 Rétrogradation</span>') +
        (myVote.commentaire ? '<div style="font-size:.67rem;color:var(--t3);margin-top:2px">' + esc(myVote.commentaire) + '</div>' : '')
      : '<span style="color:var(--t3);font-size:.75rem">—</span>';

    var allVotesHtml = '';
    var applyHtml = '';
    if (isCmd) {
      if (!av.length) {
        allVotesHtml = '<span style="color:var(--t3);font-size:.75rem">—</span>';
      } else {
        var pCount = av.filter(function(v){ return v.decision === 'promotion'; }).length;
        var rCount = av.filter(function(v){ return v.decision === 'retrogradation'; }).length;
        allVotesHtml = av.map(function(v) {
          var dc = { promotion:'#2ecc71', maintien:'var(--t2)', retrogradation:'#e74c3c' };
          var di = { promotion:'📈', maintien:'➡️', retrogradation:'📉' };
          return '<div style="font-size:.72rem;color:' + (dc[v.decision]||'var(--t2)') + ';line-height:1.5">' +
            (di[v.decision]||'❓') + ' <strong>' + esc(v.voter_name || '?') + '</strong>' +
            (v.commentaire ? ' — <span style="color:var(--t3)">' + esc(v.commentaire) + '</span>' : '') +
          '</div>';
        }).join('');
        var badge = (pCount === av.length)
          ? '<span class="badge" style="background:rgba(201,168,76,.15);color:var(--gold);border:1px solid rgba(201,168,76,.3);font-size:.63rem;margin-top:4px;display:inline-block">✅ UNANIMITÉ</span>'
          : '<span class="badge badge-gray" style="font-size:.63rem;margin-top:4px;display:inline-block">⚠️ PARTAGÉ</span>';
        allVotesHtml += '<div>' + badge + '</div>';

        var aid = a.id, an = esc(a.prenom+' '+a.nom), ag = esc(a.grade||'');
        if (!voteLocked && pCount === av.length) {
          applyHtml = '<button class="btn btn-primary btn-sm" style="font-size:.72rem;white-space:nowrap" onclick="applyCeremonieDecision(\'' + aid + '\',\'promotion\',\'' + an + '\',\'' + ag + '\')">✅ Appliquer</button>';
        } else if (!voteLocked && rCount === av.length) {
          applyHtml = '<button class="btn btn-danger btn-sm" style="font-size:.72rem;white-space:nowrap" onclick="applyCeremonieDecision(\'' + aid + '\',\'retrogradation\',\'' + an + '\',\'' + ag + '\')">✅ Appliquer</button>';
        }
      }
    }

    var voteBtn = voteLocked
      ? '<span class="badge badge-gray" title="Vote désactivé pour ce grade">🔒 Non votable</span>'
      : '<button class="btn btn-ghost btn-sm" onclick="openCeremonieVoteModal(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.grade||'') + '\')">' + (myVote ? '✏️ Modifier' : '🗳️ Voter') + '</button>';

    var row = '<tr>' +
      '<td class="cer-mat"><span>#' + esc(String(a.matricule || '—').padStart(2, '0')) + '</span></td>' +
      '<td class="cer-agent" onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})"><strong>' + esc(a.prenom + ' ' + a.nom) + '</strong><small>Ouvrir la fiche</small></td>' +
      '<td class="cer-grade">' + gradeBadge(a.grade) + '</td>' +
      '<td class="cer-opinion">' + myVoteHtml + '</td>';
    if (isCmd) row += '<td class="cer-allvotes">' + allVotesHtml + '</td><td class="cer-apply">' + applyHtml + '</td>';
    row += '<td class="cer-actions">' + voteBtn + '</td></tr>';
    return row;
  }).join('');

  var theadExtra = isCmd ? '<th>TOUS LES AVIS</th><th></th>' : '';
  setContent(
    '<div class="flex-between mb-20">' +
      '<div><h1 style="font-size:1.4rem">🎖️ Préparation Cérémonie</h1>' +
      '<p class="text-muted">Votes de grade — session en cours</p></div>' +
    '</div>' +
    debriefHtml +
    '<div class="card ceremonie-card">' +
      '<div class="table-wrap ceremonie-wrap"><table class="ceremonie-table">' +
        '<thead><tr><th>#</th><th>AGENT</th><th>GRADE ACTUEL</th><th>MON AVIS</th>' + theadExtra + '<th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
    '</div>' +
    archivesHtml
  );
}

function openCeremonieVoteModal(agentId, agentName, grade) {
  if (isCeremonieVoteLockedGrade(grade)) {
    toast('Vote désactivé pour ce grade.', 'info');
    return;
  }
  window._cVoteId = agentId;
  window._cVoteGrade = grade || '';
  window._cDecision = null;
  openModal({
    eyebrow: 'VOTE · ' + grade,
    title: agentName,
    body: '<div style="display:flex;flex-direction:column;gap:14px">' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-primary" style="flex:1" onclick="setCeremonieDecision(\'promotion\')">📈 Promotion</button>' +
        '<button class="btn btn-ghost"   style="flex:1;border:1px solid var(--border0)" onclick="setCeremonieDecision(\'maintien\')">➡️ Maintien</button>' +
        '<button class="btn btn-danger"  style="flex:1" onclick="setCeremonieDecision(\'retrogradation\')">📉 Rétrogradation</button>' +
      '</div>' +
      '<div id="cVoteStatus" style="font-size:.8rem;color:var(--t3);text-align:center">Sélectionne une décision</div>' +
      '<div><label style="font-size:.75rem;color:var(--t3);display:block;margin-bottom:4px">Commentaire <span id="cCommentReq" style="color:#e74c3c"></span></label>' +
        '<textarea id="cComment" rows="3" placeholder="Facultatif…" style="width:100%;background:var(--bg2);color:var(--t0);border:1px solid var(--border0);border-radius:6px;padding:8px;font-size:.85rem;resize:vertical"></textarea>' +
      '</div>' +
    '</div>',
    footer: '<button class="btn btn-ghost btn-sm" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-primary btn-sm" id="cSubmitBtn" disabled onclick="submitCeremonieVote()">Enregistrer</button>'
  });
}

function setCeremonieDecision(decision) {
  window._cDecision = decision;
  var labels = { promotion: '📈 Promotion sélectionnée', maintien: '➡️ Maintien sélectionné', retrogradation: '📉 Rétrogradation sélectionnée' };
  var colors = { promotion: '#2ecc71', maintien: 'var(--t2)', retrogradation: '#e74c3c' };
  document.getElementById('cVoteStatus').textContent = labels[decision] || '';
  document.getElementById('cVoteStatus').style.color = colors[decision] || 'var(--t2)';
  document.getElementById('cCommentReq').textContent = decision === 'retrogradation' ? '(obligatoire)' : '';
  document.getElementById('cSubmitBtn').disabled = false;
}

async function submitCeremonieVote() {
  var decision = window._cDecision;
  var commentaire = (document.getElementById('cComment').value || '').trim();
  if (isCeremonieVoteLockedGrade(window._cVoteGrade)) { toast('Vote désactivé pour ce grade.', 'error'); return; }
  if (!decision) { toast('Sélectionne une décision', 'error'); return; }
  if (decision === 'retrogradation' && !commentaire) { toast('Commentaire obligatoire pour une rétrogradation', 'error'); return; }
  var myId = ceremonieVoterId();
  var myName = _whoAmI();
  var { error } = await DB.upsertCeremonieVote({ agent_id: window._cVoteId, voter_discord_id: myId, voter_name: myName, decision: decision, commentaire: commentaire || null });
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast('Vote enregistré', 'success');
  closeModal();
  await renderCeremonie();
}

function applyCeremonieDecision(agentId, decision, agentName, currentGrade) {
  var sortedG = _grades.slice().sort(function(a,b){ return (a.ordre||0)-(b.ordre||0); });
  var idx = sortedG.findIndex(function(g){ return g.nom === currentGrade; });
  var newGrade = decision === 'promotion'
    ? (idx >= 0 && idx < sortedG.length - 1 ? sortedG[idx+1].nom : null)
    : (idx > 0 ? sortedG[idx-1].nom : null);
  if (!newGrade) { toast(decision === 'promotion' ? 'Grade maximum atteint' : 'Grade minimum atteint', 'error'); return; }
  openModal({
    eyebrow: decision === 'promotion' ? 'PROMOTION' : 'RÉTROGRADATION',
    title: agentName,
    body: '<p style="color:var(--t1);font-size:1rem">' +
      (decision === 'promotion' ? '📈' : '📉') + ' ' + esc(currentGrade) + ' → <strong>' + esc(newGrade) + '</strong></p>',
    footer: '<button class="btn btn-ghost btn-sm" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-primary btn-sm" onclick="closeModal();confirmCeremonieDecision(\'' + agentId + '\',\'' + newGrade.replace(/'/g,"\\'") + '\',\'' + agentName.replace(/'/g,"\\'") + '\',\'' + decision + '\')">Confirmer</button>'
  });
}

async function confirmCeremonieDecision(agentId, newGrade, agentName, decision) {
  var { error } = await DB.updateAgent(agentId, { grade: newGrade });
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  sendLog(decision === 'promotion' ? '📈 Promotion — Cérémonie' : '📉 Rétrogradation — Cérémonie', decision === 'promotion' ? 0x2ecc71 : 0xe74c3c, [
    { name: 'Agent', value: agentName, inline: true },
    { name: 'Nouveau grade', value: newGrade, inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  toast(decision === 'promotion' ? '🎖️ Promotion appliquée !' : 'Rétrogradation appliquée.', 'success');
  await renderCeremonie();
}

function resetCeremonieVotes() {
  openModal({
    eyebrow: 'CÉRÉMONIE', title: 'Réinitialiser les votes ?',
    body: '<p style="color:var(--t1)">Une archive de la session sera créée, puis les votes en cours seront supprimés.</p>',
    footer: '<button class="btn btn-ghost btn-sm" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-danger btn-sm" onclick="closeModal();confirmResetCeremonieVotes()">Supprimer</button>'
  });
}

function buildCeremonieArchivePayload(agents, votes) {
  var byAgent = {};
  agents.forEach(function(a){ byAgent[a.id] = a; });
  var votesByAgent = {};
  votes.forEach(function(v) {
    if (!votesByAgent[v.agent_id]) votesByAgent[v.agent_id] = [];
    votesByAgent[v.agent_id].push(v);
  });
  var promotions = 0, retros = 0, discuter = 0;
  Object.keys(votesByAgent).forEach(function(agentId) {
    var av = votesByAgent[agentId] || [];
    if (!av.length) return;
    var p = av.filter(function(v){ return v.decision === 'promotion'; }).length;
    var r = av.filter(function(v){ return v.decision === 'retrogradation'; }).length;
    if (p === av.length) promotions++;
    else if (r === av.length) retros++;
    else discuter++;
  });
  var now = new Date();
  return {
    session_label: 'Reset du ' + now.toLocaleDateString('fr-FR') + ' à ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    archived_by: _whoAmI(),
    votes_count: votes.length,
    agents_count: Object.keys(votesByAgent).length,
    summary: {
      promotions_unanimes: promotions,
      retrogradations_unanimes: retros,
      a_discuter: discuter
    },
    votes: votes.map(function(v) {
      var a = byAgent[v.agent_id] || {};
      return {
        agent_id: v.agent_id,
        agent_matricule: a.matricule || '',
        agent_nom: ((a.prenom || '') + ' ' + (a.nom || '')).trim(),
        agent_grade: a.grade || '',
        voter_discord_id: v.voter_discord_id || '',
        voter_name: v.voter_name || '',
        decision: v.decision || '',
        commentaire: v.commentaire || '',
        created_at: v.created_at || ''
      };
    })
  };
}

function openCeremonieArchive(id) {
  var ar = (_ceremonieArchives || []).find(function(x){ return String(x.id) === String(id); });
  if (!ar) { toast('Archive introuvable.', 'error'); return; }
  var s = ar.summary || {};
  var votes = Array.isArray(ar.votes) ? ar.votes.slice() : [];
  votes.sort(function(a, b) {
    var ma = parseInt(String(a.agent_matricule || '999').replace(/\D/g, ''), 10);
    var mb = parseInt(String(b.agent_matricule || '999').replace(/\D/g, ''), 10);
    if (isNaN(ma)) ma = 999;
    if (isNaN(mb)) mb = 999;
    return ma - mb || String(a.agent_nom || '').localeCompare(String(b.agent_nom || ''), 'fr', { numeric: true });
  });
  var decisionBadge = function(d) {
    if (d === 'promotion') return '<span class="badge" style="background:rgba(46,204,113,.15);color:#2ecc71;border:1px solid rgba(46,204,113,.3)">📈 Promotion</span>';
    if (d === 'retrogradation') return '<span class="badge badge-red">📉 Rétrogradation</span>';
    return '<span class="badge badge-gray">➡️ Maintien</span>';
  };
  var body = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">' +
      '<div class="mini-stat"><strong>' + esc(ar.votes_count || 0) + '</strong><span>votes</span></div>' +
      '<div class="mini-stat"><strong>' + esc(s.promotions_unanimes || 0) + '</strong><span>promotions</span></div>' +
      '<div class="mini-stat"><strong>' + esc(s.retrogradations_unanimes || 0) + '</strong><span>rétrogradations</span></div>' +
      '<div class="mini-stat"><strong>' + esc(s.a_discuter || 0) + '</strong><span>à discuter</span></div>' +
    '</div>' +
    (votes.length
      ? '<div class="table-wrap" style="max-height:60vh;overflow:auto"><table><thead><tr><th>#</th><th>AGENT</th><th>GRADE</th><th>VOTANT</th><th>DÉCISION</th><th>COMMENTAIRE</th></tr></thead><tbody>' +
        votes.map(function(v) {
          return '<tr>' +
            '<td><span class="mono text-gold">#' + esc(v.agent_matricule || '—') + '</span></td>' +
            '<td><strong>' + esc(v.agent_nom || 'Agent inconnu') + '</strong></td>' +
            '<td>' + esc(v.agent_grade || '—') + '</td>' +
            '<td>' + esc(v.voter_name || '—') + '</td>' +
            '<td>' + decisionBadge(v.decision) + '</td>' +
            '<td style="max-width:360px;color:var(--t2)">' + esc(v.commentaire || '—') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>'
      : '<div class="empty-state" style="padding:24px"><div class="empty-title">Aucun vote dans cette archive</div></div>');
  openModal({
    eyebrow: 'ARCHIVE · ' + esc(fmt(ar.created_at)),
    title: ar.session_label || 'Archive cérémonie',
    body: body,
    footer: '<button class="btn btn-danger btn-sm" onclick="closeModal();deleteCeremonieArchive(\'' + esc(ar.id) + '\')">Supprimer</button>' +
            '<button class="btn btn-primary btn-sm" onclick="closeModal()">Fermer</button>'
  });
}

async function deleteCeremonieArchive(id) {
  var ar = (_ceremonieArchives || []).find(function(x){ return String(x.id) === String(id); });
  var label = ar ? (ar.session_label || fmt(ar.created_at)) : 'cette archive';
  if (!confirm('Supprimer définitivement ' + label + ' ?')) return;
  var { error } = await DB.deleteCeremonieArchive(id);
  if (error) { toast('Erreur suppression archive : ' + error.message, 'error'); return; }
  toast('Archive supprimée.', 'success');
  await renderCeremonie();
}

async function confirmResetCeremonieVotes() {
  var [agents, votes] = await Promise.all([DB.getAgents(), DB.getCeremonieVotes()]);
  if (votes.length) {
    var archive = buildCeremonieArchivePayload(agents, votes);
    var saved = await DB.createCeremonieArchive(archive);
    if (saved.error) {
      var missingTable = saved.error.code === 'PGRST205' || /ceremonie_archives/i.test(saved.error.message || '');
      toast(missingTable ? 'Table archives manquante : exécute ceremonie-archives.sql dans Supabase.' : 'Archive non créée : ' + saved.error.message, 'error');
      return;
    }
  }
  var { error } = await DB.deleteCeremonieVotes();
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast(votes.length ? 'Archive créée, votes réinitialisés' : 'Votes réinitialisés', 'success');
  await renderCeremonie();
}

// ══ CARTES ════════════════════════════════════════════════════════
var CID_STORE_KEY = 'sasp_cid_cases_v1';
var CID_STATUTS = ['Ouvert', 'Ferme', 'Suspendu', 'Classe', 'Cold Case', 'En attente'];
var CID_CLASSIFICATIONS = ['Homicide','Tentative','Braquage','Criminalite organisee','Corruption','Terrorisme','Enlevement','Stupefiants','Fraude','Cybercriminalite','Violences','Cambriolage','Autre'];
var CID_PRIORITES = ['Faible','Normale','Haute','Critique'];
var CID_CONFIDENTIALITES = ['Public SASP','CID uniquement','Etat-major','Ultra confidentiel'];
function cidLoad(){ try{return JSON.parse(localStorage.getItem(CID_STORE_KEY)||'[]')||[];}catch(e){return[];} }
function cidSave(list){ localStorage.setItem(CID_STORE_KEY, JSON.stringify(list||[])); }
function cidNow(){ return new Date().toISOString().slice(0,16).replace('T',' '); }
function cidOptions(values, selected){ return values.map(function(v){return '<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(v)+'</option>';}).join(''); }
function cidNextNumber(list){ var y=new Date().getFullYear(); var m=(list||[]).reduce(function(a,c){var n=String(c.numero||'').match(/CID-\d{4}-(\d+)/);return Math.max(a,n?parseInt(n[1],10):0);},0)+1; return 'CID-'+y+'-'+String(m).padStart(4,'0'); }
function cidGet(id){ return cidLoad().find(function(c){return c.id===id;}); }
function cidUpsert(data){ var list=cidLoad(); if(data.id){list=list.map(function(c){return c.id===data.id?Object.assign({},c,data,{updated_at:cidNow()}):c;});}else{data.id='cid_'+Date.now();data.numero=cidNextNumber(list);data.date_ouverture=cidNow();data.updated_at=cidNow();data.personnes=[];data.preuves=[];data.journal=[{date:cidNow(),texte:'Dossier cree'}];list.unshift(data);} cidSave(list); }
function cidDelete(id){ if(!confirm('Supprimer ce dossier CID ?'))return; cidSave(cidLoad().filter(function(c){return c.id!==id;})); navigate('cid'); }
function cidCreateFromForm(){ var f=document.getElementById('cidCreateForm'); if(!f)return; var fd=new FormData(f); cidUpsert({titre:fd.get('titre')||'Dossier sans titre',resume:fd.get('resume')||'',description:fd.get('description')||'',date_faits:fd.get('date_faits')||'',lieu:fd.get('lieu')||'',nature:fd.get('nature')||'',classification:fd.get('classification')||'Autre',priorite:fd.get('priorite')||'Normale',confidentialite:fd.get('confidentialite')||'CID uniquement',statut:'Ouvert',responsable:S.serverNick||(S.appUser?((S.appUser.prenom||'')+' '+(S.appUser.nom||'')).trim():'CID'),membres:'',suspects:0}); closeModal(); navigate('cid'); }
function cidUpdateCase(id){ var c=cidGet(id), f=document.getElementById('cidEditForm'); if(!c||!f)return; var fd=new FormData(f); cidUpsert(Object.assign({},c,{titre:fd.get('titre')||c.titre,statut:fd.get('statut')||c.statut,priorite:fd.get('priorite')||c.priorite,classification:fd.get('classification')||c.classification,confidentialite:fd.get('confidentialite')||c.confidentialite,responsable:fd.get('responsable')||'',membres:fd.get('membres')||'',lieu:fd.get('lieu')||'',nature:fd.get('nature')||'',resume:fd.get('resume')||'',description:fd.get('description')||''})); toast('Dossier CID sauvegarde.'); navigate('cid',{id:id}); }
function cidAddPerson(id){ var c=cidGet(id); if(!c)return; var nom=prompt('Nom / Prenom de la personne ?'); if(!nom)return; var type=prompt('Type : Citoyen, Suspect, Victime, Temoin, Informateur, Agent infiltre, Enqueteur','Suspect')||'Citoyen'; var tel=prompt('Numero de telephone ?','')||''; var danger=prompt('Dangerosite ?','Inconnue')||'Inconnue'; c.personnes=c.personnes||[]; c.personnes.push({id:'p_'+Date.now(),nom:nom,type:type,tel:tel,danger:danger,statut:'Actif',commentaires:''}); c.suspects=c.personnes.filter(function(p){return /suspect/i.test(p.type);}).length; c.journal=c.journal||[]; c.journal.unshift({date:cidNow(),texte:'Personne ajoutee : '+nom}); cidUpsert(c); navigate('cid',{id:id}); }
function cidAddProof(id){ var c=cidGet(id); if(!c)return; var type=prompt('Type de preuve ?','Document')||'Autre'; var desc=prompt('Description de la preuve ?','')||''; var lieu=prompt('Lieu de decouverte ?',c.lieu||'')||''; c.preuves=c.preuves||[]; var seal='SC-'+new Date().getFullYear()+'-'+String(c.preuves.length+1).padStart(4,'0'); c.preuves.push({id:'e_'+Date.now(),scelle:seal,codebarres:seal.replace(/\D/g,'')+Date.now().toString().slice(-4),type:type,description:desc,lieu:lieu,date:cidNow(),decouvert_par:S.serverNick||'CID',etat:'Inventorie',localisation:'CID',chaine:[{date:cidNow(),texte:'Ajout au dossier'}]}); c.journal=c.journal||[]; c.journal.unshift({date:cidNow(),texte:'Preuve ajoutee : '+seal}); cidUpsert(c); navigate('cid',{id:id}); }
function cidAddLog(id){ var c=cidGet(id); if(!c)return; var texte=prompt('Note / action a ajouter au journal ?'); if(!texte)return; c.journal=c.journal||[]; c.journal.unshift({date:cidNow(),texte:texte}); cidUpsert(c); navigate('cid',{id:id}); }
function cidCss(){ return '<style>.cid-page{display:grid;gap:18px}.cid-hero,.cid-card{background:linear-gradient(135deg,rgba(9,18,34,.98),rgba(8,15,28,.94));border:1px solid rgba(90,132,180,.35);border-radius:8px;padding:18px;box-shadow:0 14px 36px rgba(0,0,0,.25)}.cid-hero{border-color:rgba(212,175,55,.45);display:flex;justify-content:space-between;gap:18px;align-items:center}.cid-kicker{font-size:10px;letter-spacing:.35em;color:#d4af37;text-transform:uppercase}.cid-title{font-size:30px;margin:8px 0 4px}.cid-sub{color:#8fb6e6}.cid-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.cid-stat strong{display:block;font-size:28px;color:#f0c94a}.cid-stat span{font-size:10px;letter-spacing:.2em;color:#8fb6e6;text-transform:uppercase}.cid-toolbar{display:flex;gap:10px;flex-wrap:wrap}.cid-toolbar input,.cid-toolbar select,.cid-card input,.cid-card select,.cid-card textarea{background:#071120;border:1px solid #1f3c60;color:#e8f2ff;border-radius:7px;padding:10px;width:100%}.cid-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cid-btn{border:1px solid rgba(212,175,55,.5);background:#d4af37;color:#071120;border-radius:7px;padding:10px 13px;font-weight:800;cursor:pointer}.cid-btn.secondary{background:rgba(31,60,96,.35);color:#b8d8ff;border-color:#1f3c60}.cid-btn.danger{background:#3a1418;color:#ff6b6b;border-color:#7f2a35}.cid-table{width:100%;border-collapse:collapse;overflow:hidden;border-radius:8px}.cid-table th,.cid-table td{border-bottom:1px solid rgba(90,132,180,.22);padding:12px;text-align:left}.cid-table th{font-size:10px;letter-spacing:.22em;color:#6f8db1;text-transform:uppercase}.cid-badge{display:inline-flex;border:1px solid rgba(212,175,55,.45);border-radius:999px;padding:4px 8px;color:#f0c94a;background:rgba(212,175,55,.1);font-size:12px;font-weight:800}.cid-panels{display:grid;grid-template-columns:1fr 1fr;gap:14px}.cid-mini-list{display:grid;gap:8px}.cid-mini{border:1px solid rgba(90,132,180,.25);border-radius:7px;padding:10px;background:rgba(5,12,24,.55)}@media(max-width:900px){.cid-stats,.cid-grid,.cid-panels{grid-template-columns:1fr}.cid-hero{display:block}.cid-table{font-size:13px}}</style>'; }
function renderCID(){ if(!canAccessCID()){setContent('<div class="empty-state"><div class="empty-icon">CID</div><div class="empty-title">Acces restreint</div><div class="empty-sub">Role CID requis.</div></div>');return;} var list=cidLoad(); if(S.pd&&S.pd.id)return renderCIDCase(S.pd.id); var q=(S.pd&&S.pd.q)||'', filter=(S.pd&&S.pd.filter)||'Toutes'; var visible=list.filter(function(c){var ok=filter==='Toutes'||c.statut===filter;var hay=[c.numero,c.titre,c.statut,c.priorite,c.classification,c.responsable].join(' ').toLowerCase();return ok&&hay.indexOf(q.toLowerCase())!==-1;}).sort(function(a,b){return String(b.updated_at||'').localeCompare(String(a.updated_at||''));}); var counts={ouverts:list.filter(function(c){return c.statut==='Ouvert';}).length,attente:list.filter(function(c){return c.statut==='En attente';}).length,cold:list.filter(function(c){return c.statut==='Cold Case';}).length,preuves:list.reduce(function(n,c){return n+((c.preuves||[]).length);},0)}; setContent('<div class="cid-page">'+cidCss()+'<section class="cid-hero"><div><div class="cid-kicker">SASP - Criminal Investigation Division</div><h1 class="cid-title">Dossiers CID</h1><p class="cid-sub">Enquetes criminelles, preuves, suspects, victimes et chaines de possession.</p></div><button class="cid-btn" onclick="document.getElementById(\'cidCreate\').scrollIntoView({behavior:\'smooth\'})">Creer un dossier</button></section><section class="cid-stats"><div class="cid-card cid-stat"><strong>'+counts.ouverts+'</strong><span>Ouvertes</span></div><div class="cid-card cid-stat"><strong>'+counts.attente+'</strong><span>En attente</span></div><div class="cid-card cid-stat"><strong>'+counts.cold+'</strong><span>Cold case</span></div><div class="cid-card cid-stat"><strong>'+counts.preuves+'</strong><span>Preuves</span></div></section><section class="cid-card"><div class="cid-toolbar"><input style="max-width:360px" placeholder="Recherche instantanee..." value="'+esc(q)+'" oninput="navigate(\'cid\',{q:this.value,filter:\''+esc(filter)+'\'})"><select style="max-width:220px" onchange="navigate(\'cid\',{filter:this.value,q:\''+esc(q)+'\'})"><option>Toutes</option>'+cidOptions(CID_STATUTS,filter)+'</select></div></section><section class="cid-card"><table class="cid-table"><thead><tr><th>Numero</th><th>Enquete</th><th>Statut</th><th>Priorite</th><th>Classification</th><th>Resp.</th><th>Suspects</th><th>Preuves</th><th>Modification</th></tr></thead><tbody>'+(visible.length?visible.map(function(c){return '<tr onclick="navigate(\'cid\',{id:\''+c.id+'\'})" style="cursor:pointer"><td>'+esc(c.numero)+'</td><td><strong>'+esc(c.titre)+'</strong><br><small>'+esc(c.resume||'')+'</small></td><td><span class="cid-badge">'+esc(c.statut)+'</span></td><td>'+esc(c.priorite)+'</td><td>'+esc(c.classification)+'</td><td>'+esc(c.responsable||'-')+'</td><td>'+(c.suspects||0)+'</td><td>'+((c.preuves||[]).length)+'</td><td>'+esc(c.updated_at||'-')+'</td></tr>';}).join(''):'<tr><td colspan="9">Aucun dossier CID.</td></tr>')+'</tbody></table></section><section class="cid-card" id="cidCreate"><h2>Creation dossier</h2><form id="cidCreateForm" onsubmit="event.preventDefault();cidCreateFromForm()"><div class="cid-grid"><input name="titre" placeholder="Titre de l enquete" required><input name="lieu" placeholder="Lieu"><select name="classification">'+cidOptions(CID_CLASSIFICATIONS,'Autre')+'</select><select name="priorite">'+cidOptions(CID_PRIORITES,'Normale')+'</select><select name="confidentialite">'+cidOptions(CID_CONFIDENTIALITES,'CID uniquement')+'</select><input name="date_faits" type="datetime-local"></div><textarea name="nature" rows="2" placeholder="Nature des faits" style="margin-top:10px"></textarea><textarea name="resume" rows="2" placeholder="Resume rapide" style="margin-top:10px"></textarea><textarea name="description" rows="5" placeholder="Description complete" style="margin-top:10px"></textarea><button class="cid-btn" style="margin-top:12px">Creer le dossier</button></form></section></div>'); }
function renderCIDCase(id){ var c=cidGet(id); if(!c){navigate('cid');return;} setContent('<div class="cid-page">'+cidCss()+'<section class="cid-card"><button class="cid-btn secondary" onclick="navigate(\'cid\')">Retour</button><div class="cid-kicker">'+esc(c.numero)+'</div><h1 class="cid-title">'+esc(c.titre)+'</h1><span class="cid-badge">'+esc(c.confidentialite)+'</span></section><section class="cid-card"><form id="cidEditForm" onsubmit="event.preventDefault();cidUpdateCase(\''+c.id+'\')"><div class="cid-grid"><input name="titre" value="'+esc(c.titre)+'"><select name="statut">'+cidOptions(CID_STATUTS,c.statut)+'</select><select name="priorite">'+cidOptions(CID_PRIORITES,c.priorite)+'</select><select name="classification">'+cidOptions(CID_CLASSIFICATIONS,c.classification)+'</select><select name="confidentialite">'+cidOptions(CID_CONFIDENTIALITES,c.confidentialite)+'</select><input name="responsable" value="'+esc(c.responsable||'')+'" placeholder="Responsable"><input name="membres" value="'+esc(c.membres||'')+'" placeholder="Membres affectes"><input name="lieu" value="'+esc(c.lieu||'')+'" placeholder="Lieu"></div><textarea name="nature" rows="2" style="margin-top:10px" placeholder="Nature des faits">'+esc(c.nature||'')+'</textarea><textarea name="resume" rows="2" style="margin-top:10px" placeholder="Resume">'+esc(c.resume||'')+'</textarea><textarea name="description" rows="5" style="margin-top:10px" placeholder="Description complete">'+esc(c.description||'')+'</textarea><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="cid-btn">Sauvegarder</button><button type="button" class="cid-btn secondary" onclick="cidAddLog(\''+c.id+'\')">Ajouter journal</button><button type="button" class="cid-btn danger" onclick="cidDelete(\''+c.id+'\')">Supprimer</button></div></form></section><section class="cid-panels"><div class="cid-card"><h2>Personnes</h2><button class="cid-btn secondary" onclick="cidAddPerson(\''+c.id+'\')">Ajouter personne</button><div class="cid-mini-list" style="margin-top:10px">'+((c.personnes||[]).length?c.personnes.map(function(p){return '<div class="cid-mini"><strong>'+esc(p.nom)+'</strong> <span class="cid-badge">'+esc(p.type)+'</span><br>Tel: '+esc(p.tel||'-')+' - Danger: '+esc(p.danger||'-')+'</div>';}).join(''):'<div class="cid-mini">Aucune personne.</div>')+'</div></div><div class="cid-card"><h2>Preuves</h2><button class="cid-btn secondary" onclick="cidAddProof(\''+c.id+'\')">Ajouter preuve</button><div class="cid-mini-list" style="margin-top:10px">'+((c.preuves||[]).length?c.preuves.map(function(e){return '<div class="cid-mini"><strong>'+esc(e.scelle)+'</strong> <span class="cid-badge">'+esc(e.type)+'</span><br>'+esc(e.description||'')+'<br>Lieu: '+esc(e.lieu||'-')+' - Code: '+esc(e.codebarres||'-')+'</div>';}).join(''):'<div class="cid-mini">Aucune preuve.</div>')+'</div></div></section><section class="cid-card"><h2>Journal / Chain of custody</h2><div class="cid-mini-list">'+((c.journal||[]).length?c.journal.map(function(j){return '<div class="cid-mini"><strong>'+esc(j.date)+'</strong><br>'+esc(j.texte)+'</div>';}).join(''):'<div class="cid-mini">Aucun historique.</div>')+'</div></section></div>'); }

function cidCreateFromForm(){
  var f = document.getElementById('cidCreateForm');
  if (!f) return;
  var fd = new FormData(f);
  cidUpsert({
    titre: fd.get('titre') || 'Dossier sans titre',
    resume: fd.get('resume') || '',
    description: fd.get('description') || '',
    date_faits: fd.get('date_faits') || '',
    lieu: fd.get('lieu') || '',
    nature: fd.get('nature') || '',
    classification: fd.get('classification') || 'Autre',
    priorite: fd.get('priorite') || 'Normale',
    confidentialite: fd.get('confidentialite') || 'CID uniquement',
    statut: 'Ouvert',
    responsable: S.serverNick || (S.appUser ? ((S.appUser.prenom || '') + ' ' + (S.appUser.nom || '')).trim() : 'CID'),
    membres: '',
    suspects: 0
  });
  closeModal();
  navigate('cid');
}

function cidOpenCreate(){
  openModal({
    eyebrow: 'CID',
    title: 'Creation dossier',
    size: 'xl',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidCreateForm" onsubmit="event.preventDefault();cidCreateFromForm()">
            <div class="cid-grid">
              <input name="titre" placeholder="Titre de l'enquete" required>
              <select name="priorite">${cidOptions(CID_PRIORITES, 'Normale')}</select>
            </div>
            <input type="hidden" name="classification" value="Autre">
            <input type="hidden" name="confidentialite" value="CID uniquement">
            <input type="hidden" name="lieu" value="">
            <input type="hidden" name="date_faits" value="">
            <textarea name="nature" rows="2" placeholder="Nature des faits" style="margin-top:10px"></textarea>
            <textarea name="resume" rows="2" placeholder="Resume rapide" style="margin-top:10px"></textarea>
            <textarea name="description" rows="5" placeholder="Description complete" style="margin-top:10px"></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidCreateFromForm()">Creer le dossier</button>'
  });
}

function cidAddPerson(id){
  var c = cidGet(id);
  if (!c) return;
  openModal({
    eyebrow: 'CID - Personne liee',
    title: 'Ajouter une personne',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidPersonForm" onsubmit="event.preventDefault();cidSavePersonModal('${id}')">
            <div class="cid-grid">
              <input name="nom" placeholder="Nom / prenom" required>
              <select name="type">${cidOptions(['Citoyen','Suspect','Victime','Temoin','Informateur','Agent infiltre','Enqueteur'], 'Suspect')}</select>
              <input name="tel" placeholder="Numero de telephone">
              <select name="danger">${cidOptions(['Inconnue','Faible','Moyenne','Elevee','Critique'], 'Inconnue')}</select>
              <select name="statut">${cidOptions(['Actif','A surveiller','Localise','Interroge','Archive'], 'Actif')}</select>
            </div>
            <textarea name="commentaires" rows="4" placeholder="Commentaires CID" style="margin-top:10px"></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="btn" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="cidSavePersonModal(\'' + id + '\')">Ajouter</button>'
  });
}

function cidSavePersonModal(id){
  var c = cidGet(id), f = document.getElementById('cidPersonForm');
  if (!c || !f) return;
  var fd = new FormData(f);
  var nom = fd.get('nom');
  if (!nom) return toast('Nom requis.');
  c.personnes = c.personnes || [];
  c.personnes.push({
    id: 'p_' + Date.now(),
    nom: nom,
    type: fd.get('type') || 'Citoyen',
    tel: fd.get('tel') || '',
    danger: fd.get('danger') || 'Inconnue',
    statut: fd.get('statut') || 'Actif',
    commentaires: fd.get('commentaires') || ''
  });
  c.suspects = c.personnes.filter(function(p){ return /suspect/i.test(p.type); }).length;
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Personne ajoutee : ' + nom});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id: id});
}

function cidAddProof(id){
  var c = cidGet(id);
  if (!c) return;
  openModal({
    eyebrow: 'CID - Preuve',
    title: 'Ajouter une preuve',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidProofForm" onsubmit="event.preventDefault();cidSaveProofModal('${id}')">
            <div class="cid-grid">
              <select name="type">${cidOptions(['Document','Photo','Video','Audio','Arme','Objet','ADN','Temoignage','Telephone','Autre'], 'Document')}</select>
              <input name="lieu" placeholder="Lieu de decouverte" value="${esc(c.lieu || '')}">
              <input name="decouvert_par" placeholder="Decouvert par" value="${esc(S.serverNick || 'CID')}">
              <select name="etat">${cidOptions(['Inventorie','Analyse en cours','Exploitee','Archivee'], 'Inventorie')}</select>
              <input name="localisation" placeholder="Localisation / stockage" value="CID">
            </div>
            <textarea name="description" rows="4" placeholder="Description de la preuve" style="margin-top:10px"></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidSaveProofModal(\'' + id + '\')">Ajouter</button>'
  });
}

function cidSaveProofModal(id){
  var c = cidGet(id), f = document.getElementById('cidProofForm');
  if (!c || !f) return;
  var fd = new FormData(f);
  c.preuves = c.preuves || [];
  var seal = 'SC-' + new Date().getFullYear() + '-' + String(c.preuves.length + 1).padStart(4, '0');
  c.preuves.push({
    id: 'e_' + Date.now(),
    scelle: seal,
    codebarres: seal.replace(/\D/g, '') + Date.now().toString().slice(-4),
    type: fd.get('type') || 'Autre',
    description: fd.get('description') || '',
    lieu: fd.get('lieu') || '',
    date: cidNow(),
    decouvert_par: fd.get('decouvert_par') || S.serverNick || 'CID',
    etat: fd.get('etat') || 'Inventorie',
    localisation: fd.get('localisation') || 'CID',
    chaine: [{date: cidNow(), texte: 'Ajout au dossier'}]
  });
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Preuve ajoutee : ' + seal});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id: id});
}

function cidAddLog(id){
  var c = cidGet(id);
  if (!c) return;
  openModal({
    eyebrow: 'CID - Journal',
    title: 'Ajouter une note',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidLogForm" onsubmit="event.preventDefault();cidSaveLogModal('${id}')">
            <textarea name="texte" rows="5" placeholder="Note, action, instruction ou observation" required></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="btn" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="cidSaveLogModal(\'' + id + '\')">Ajouter</button>'
  });
}

function cidSaveLogModal(id){
  var c = cidGet(id), f = document.getElementById('cidLogForm');
  if (!c || !f) return;
  var texte = new FormData(f).get('texte');
  if (!texte) return toast('Note requise.');
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: texte});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id: id});
}

function renderCID2(){
  if (!canAccessCID()) {
    setContent('<div class="empty-state"><div class="empty-icon">CID</div><div class="empty-title">Acces restreint</div><div class="empty-sub">Role CID requis.</div></div>');
    return;
  }
  if (S.pd && S.pd.id) return renderCIDCase(S.pd.id);
  var list = cidLoad();
  var q = (S.pd && S.pd.q) || '';
  var filter = (S.pd && S.pd.filter) || 'Toutes';
  var visible = list.filter(function(c){
    var ok = filter === 'Toutes' || c.statut === filter;
    var hay = [c.numero, c.titre, c.statut, c.priorite, c.classification, c.responsable].join(' ').toLowerCase();
    return ok && hay.indexOf(q.toLowerCase()) !== -1;
  }).sort(function(a,b){ return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
  var counts = {
    ouverts: list.filter(function(c){ return c.statut === 'Ouvert'; }).length,
    attente: list.filter(function(c){ return c.statut === 'En attente'; }).length,
    cold: list.filter(function(c){ return c.statut === 'Cold Case'; }).length,
    preuves: list.reduce(function(n,c){ return n + ((c.preuves || []).length); }, 0)
  };
  setContent(`
    <div class="cid-page">
      ${cidCss()}
      <section class="cid-hero">
        <div>
          <div class="cid-kicker">SASP - Criminal Investigation Division</div>
          <h1 class="cid-title">Dossiers CID</h1>
          <p class="cid-sub">Enquetes criminelles, preuves, suspects, victimes et chaines de possession.</p>
        </div>
        <button class="cid-btn" onclick="cidOpenCreate()">Creer un dossier</button>
      </section>
      <section class="cid-stats">
        <div class="cid-card cid-stat"><strong>${counts.ouverts}</strong><span>Ouvertes</span></div>
        <div class="cid-card cid-stat"><strong>${counts.attente}</strong><span>En attente</span></div>
        <div class="cid-card cid-stat"><strong>${counts.cold}</strong><span>Cold case</span></div>
        <div class="cid-card cid-stat"><strong>${counts.preuves}</strong><span>Preuves</span></div>
      </section>
      <section class="cid-card">
        <div class="cid-toolbar">
          <input id="cidSearchInput" style="max-width:360px" placeholder="Recherche instantanee..." value="${esc(q)}">
          <select id="cidFilterSelect" style="max-width:220px"><option>Toutes</option>${cidOptions(CID_STATUTS, filter)}</select>
        </div>
      </section>
      <section class="cid-card">
        <table class="cid-table">
          <thead><tr><th>Numero</th><th>Enquete</th><th>Statut</th><th>Priorite</th><th>Classification</th><th>Resp.</th><th>Suspects</th><th>Preuves</th><th>Modification</th></tr></thead>
          <tbody>
            ${visible.length ? visible.map(function(c){
              return "<tr onclick=\"navigate('cid',{id:'" + c.id + "'})\" style=\"cursor:pointer\"><td>" + esc(c.numero) + "</td><td><strong>" + esc(c.titre) + "</strong><br><small>" + esc(c.resume || "") + "</small></td><td><span class=\"cid-badge\">" + esc(c.statut) + "</span></td><td>" + esc(c.priorite) + "</td><td>" + esc(c.classification) + "</td><td>" + esc(c.responsable || "-") + "</td><td>" + (c.suspects || 0) + "</td><td>" + ((c.preuves || []).length) + "</td><td>" + esc(c.updated_at || "-") + "</td></tr>";
            }).join('') : '<tr><td colspan="9">Aucun dossier CID.</td></tr>'}
          </tbody>
        </table>
      </section>
    </div>
  `);
  var search = document.getElementById('cidSearchInput');
  var select = document.getElementById('cidFilterSelect');
  if (search) search.addEventListener('input', function(){ navigate('cid', {q: this.value, filter: select ? select.value : filter}); });
  if (select) select.addEventListener('change', function(){ navigate('cid', {filter: this.value, q: search ? search.value : q}); });
}

function cidCss2(){
  return `<style>
    .cid-mdt{display:grid;gap:14px;color:#dbeafe}
    .cid-mdt *{box-sizing:border-box}
    .cid-topbar{display:grid;grid-template-columns:1fr minmax(280px,520px) auto;gap:14px;align-items:center;background:linear-gradient(135deg,rgba(11,24,43,.96),rgba(7,14,26,.96));border:1px solid rgba(76,112,154,.32);border-radius:8px;padding:12px 14px;box-shadow:0 16px 42px rgba(0,0,0,.28)}
    .cid-brand{display:flex;align-items:center;gap:12px}.cid-brand-icon{width:36px;height:36px;border:1px solid rgba(75,140,255,.32);border-radius:8px;display:grid;place-items:center;background:rgba(15,30,52,.85);color:#7db4ff;font-weight:900}
    .cid-brand-title{font-size:18px;font-weight:900;letter-spacing:.02em}.cid-brand-sub{font-size:11px;color:#8ea8c8}.cid-global-search{position:relative}.cid-global-search input{width:100%;background:#07111f;border:1px solid rgba(80,122,170,.35);border-radius:7px;color:#dbeafe;padding:12px 44px 12px 36px}.cid-global-search:before{content:'⌕';position:absolute;left:13px;top:9px;color:#7fa8d6}.cid-key{position:absolute;right:8px;top:8px;border:1px solid rgba(126,162,208,.28);border-radius:5px;padding:3px 8px;color:#93a9c4;font-size:11px;background:rgba(255,255,255,.04)}
    .cid-session{display:flex;gap:10px;align-items:center;justify-content:flex-end}.cid-pill{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(78,117,161,.35);border-radius:7px;background:rgba(9,18,34,.82);padding:9px 11px;color:#c9dcf5;font-size:12px}.cid-dot{width:7px;height:7px;border-radius:50%;background:#20df78;box-shadow:0 0 14px rgba(32,223,120,.7)}
    .cid-shell{display:grid;grid-template-columns:340px minmax(0,1fr);gap:14px;min-height:690px}.cid-list-pane,.cid-workspace,.cid-panel{background:linear-gradient(145deg,rgba(11,24,43,.96),rgba(8,16,29,.98));border:1px solid rgba(79,117,160,.34);border-radius:8px;box-shadow:0 16px 42px rgba(0,0,0,.2)}
    .cid-list-pane{display:grid;grid-template-rows:auto auto 1fr auto;overflow:hidden}.cid-pane-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px;border-bottom:1px solid rgba(82,120,166,.22)}.cid-pane-title{font-size:18px;font-weight:900}.cid-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .cid-blue-btn,.cid-gold-btn,.cid-soft-btn,.cid-red-btn{border-radius:6px;padding:7px 10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:900;cursor:pointer;background:rgba(7,16,30,.72)}.cid-blue-btn{color:#8fbaff;border:1px solid rgba(75,145,255,.42)}.cid-gold-btn{color:#f2cd55;border:1px solid rgba(214,179,68,.5)}.cid-soft-btn{color:#bfd8fb;border:1px solid rgba(83,125,175,.35)}.cid-red-btn{color:#ff7676;border:1px solid rgba(255,90,90,.42)}
    .cid-filter-zone{padding:12px 15px;display:grid;gap:10px;border-bottom:1px solid rgba(82,120,166,.18)}.cid-filter-zone input,.cid-filter-zone select{background:#07111f;border:1px solid rgba(80,122,170,.35);border-radius:7px;color:#dbeafe;padding:10px}.cid-tabs{display:flex;gap:6px;overflow:auto}.cid-tab{font-size:11px;border:0;background:transparent;color:#8ea8c8;padding:8px 10px;border-radius:6px;cursor:pointer}.cid-tab.active{background:rgba(23,105,255,.12);color:#6fb2ff;border-bottom:1px solid #2f83ff}
    .cid-case-list{padding:10px;overflow:auto;display:grid;gap:8px;align-content:start}.cid-case-card{border:1px solid rgba(74,114,159,.26);background:rgba(7,16,30,.78);border-radius:7px;padding:12px;cursor:pointer;transition:.15s}.cid-case-card:hover,.cid-case-card.active{border-color:#2d86ff;background:linear-gradient(135deg,rgba(14,37,68,.96),rgba(7,17,31,.96));box-shadow:inset 3px 0 #2d86ff}.cid-card-top{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#7fa8d6}.cid-case-name{margin:8px 0 4px;font-size:14px;font-weight:900;color:#eef6ff}.cid-case-meta{display:flex;justify-content:space-between;gap:10px;color:#8ea8c8;font-size:11px}.cid-footer-pages{padding:12px 15px;border-top:1px solid rgba(82,120,166,.18);color:#8ea8c8;font-size:12px}
    .cid-badge2{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:900;border:1px solid rgba(130,162,206,.22);background:rgba(255,255,255,.04);color:#bdd6f9}.cid-badge2.red{color:#ff6666;background:rgba(255,54,54,.12);border-color:rgba(255,74,74,.25)}.cid-badge2.orange{color:#ffb44f;background:rgba(255,144,48,.12);border-color:rgba(255,171,68,.25)}.cid-badge2.blue{color:#62a8ff;background:rgba(47,124,255,.12);border-color:rgba(75,145,255,.28)}.cid-badge2.green{color:#48e58b;background:rgba(36,210,109,.12);border-color:rgba(56,220,132,.28)}.cid-badge2.gold{color:#f2cd55;background:rgba(214,179,68,.13);border-color:rgba(214,179,68,.32)}
    .cid-workspace{padding:16px;overflow:auto}.cid-return{border:0;background:transparent;color:#8ea8c8;cursor:pointer;margin-bottom:12px}.cid-case-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:start;border-bottom:1px solid rgba(82,120,166,.2);padding-bottom:14px}.cid-case-id{font-size:14px;color:#91b4df}.cid-case-title{font-size:25px;font-weight:900;margin:6px 0}.cid-subline{display:flex;gap:16px;flex-wrap:wrap;color:#91a9c5;font-size:12px}.cid-summary-chips{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px}.cid-chip{border:1px solid rgba(76,112,154,.28);background:rgba(9,18,34,.65);border-radius:8px;padding:10px}.cid-chip span{display:block;color:#8aa2c0;font-size:11px}.cid-chip strong{display:block;margin-top:5px;color:#fff}
    .cid-nav-tabs{display:flex;gap:8px;overflow:auto;border-bottom:1px solid rgba(82,120,166,.2);padding:12px 0}.cid-nav-tabs span{font-size:12px;color:#a9c2e2;padding:8px 10px;border-radius:7px}.cid-nav-tabs span.active{color:#65a7ff;border-bottom:2px solid #2d86ff;background:rgba(45,134,255,.08)}
    .cid-detail-grid{display:grid;grid-template-columns:1.1fr 1fr .9fr;gap:14px;margin-top:14px}.cid-panel{padding:14px}.cid-panel h3{margin:0 0 12px;font-size:16px}.cid-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cid-field span{display:block;color:#7f96b3;font-size:11px;margin-bottom:4px}.cid-field strong{color:#edf6ff;font-size:13px}.cid-text{color:#c7d8ef;line-height:1.55;font-size:13px}.cid-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.cid-stat-box{border:1px solid rgba(80,122,170,.25);border-radius:7px;padding:12px;background:rgba(7,16,30,.62);text-align:center}.cid-stat-box b{display:block;font-size:22px;color:#fff}.cid-stat-box span{font-size:11px;color:#8ea8c8}.cid-timeline{display:grid;gap:10px}.cid-time{border-left:2px solid #2d86ff;padding-left:10px;color:#c7d8ef;font-size:13px}.cid-time small{display:block;color:#7f96b3;margin-bottom:2px}.cid-mini-table{width:100%;border-collapse:collapse}.cid-mini-table th,.cid-mini-table td{border-bottom:1px solid rgba(82,120,166,.18);padding:10px;text-align:left;font-size:12px}.cid-mini-table th{color:#8ca6c7;font-size:10px;text-transform:uppercase;letter-spacing:.12em}.cid-empty-panel{display:grid;place-items:center;min-height:400px;text-align:center;color:#8ea8c8}
    @media(max-width:1200px){.cid-shell{grid-template-columns:1fr}.cid-detail-grid{grid-template-columns:1fr}.cid-topbar{grid-template-columns:1fr}.cid-summary-chips{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.cid-summary-chips,.cid-info-grid,.cid-stat-grid{grid-template-columns:1fr}.cid-case-head{grid-template-columns:1fr}}
  </style>`;
}

function cidPriorityTone(value){
  value = String(value || '').toLowerCase();
  if (value.indexOf('crit') !== -1 || value.indexOf('haute') !== -1) return 'red';
  if (value.indexOf('norm') !== -1) return 'gold';
  if (value.indexOf('faible') !== -1) return 'green';
  return 'blue';
}

function cidStatusTone(value){
  value = String(value || '').toLowerCase();
  if (value.indexOf('ouvert') !== -1 || value.indexOf('cours') !== -1) return 'blue';
  if (value.indexOf('attente') !== -1) return 'orange';
  if (value.indexOf('ferme') !== -1 || value.indexOf('classe') !== -1) return 'green';
  if (value.indexOf('cold') !== -1 || value.indexOf('suspend') !== -1) return 'red';
  return 'gold';
}

function cidPersonTypeCounts(c){
  var out = {Suspects:0, Victimes:0, Temoins:0, Informateurs:0, Enqueteurs:0};
  (c.personnes || []).forEach(function(p){
    var t = String(p.type || '').toLowerCase();
    if (t.indexOf('suspect') !== -1) out.Suspects++;
    else if (t.indexOf('victime') !== -1) out.Victimes++;
    else if (t.indexOf('temoin') !== -1) out.Temoins++;
    else if (t.indexOf('informateur') !== -1) out.Informateurs++;
    else if (t.indexOf('enqueteur') !== -1 || t.indexOf('agent') !== -1) out.Enqueteurs++;
  });
  return out;
}

function cidCaseWorkspace(c){
  if (!c) {
    return '<section class="cid-workspace cid-empty-panel"><div><div class="cid-brand-icon" style="margin:0 auto 12px">CID</div><h2>Aucun dossier selectionne</h2><p>Creer ou selectionner un dossier pour ouvrir le poste de travail.</p></div></section>';
  }
  var pc = cidPersonTypeCounts(c);
  var proofs = c.preuves || [];
  var people = c.personnes || [];
  var notes = (c.journal || []).filter(cidIsUserNote);
  return `
    <section class="cid-workspace">
      <button class="cid-return" onclick="navigate('cid')">← Retour aux dossiers</button>
      <div class="cid-case-head">
        <div>
          <div class="cid-case-id">${esc(c.numero || 'CID')}</div>
          <h1 class="cid-case-title">${esc(c.titre || 'Dossier sans titre')}</h1>
          <div class="cid-subline">
            <span>Ouvert le ${esc(c.date_ouverture || '-')}</span>
            <span>Derniere modif. ${esc(c.updated_at || '-')}</span>
            <span>Par ${esc(c.responsable || 'CID')}</span>
          </div>
        </div>
        <div class="cid-actions">
          <button class="cid-soft-btn" onclick="cidAddLog('${c.id}')">Note</button>
          <button class="cid-blue-btn" onclick="cidAddPerson('${c.id}')">Personne</button>
          <button class="cid-gold-btn" onclick="cidAddProof('${c.id}')">Preuve</button>
        </div>
      </div>
      <div class="cid-summary-chips" style="margin-top:14px">
        <div class="cid-chip"><span>Statut</span><strong><span class="cid-badge2 ${cidStatusTone(c.statut)}">${esc(c.statut || '-')}</span></strong></div>
        <div class="cid-chip"><span>Priorite</span><strong><span class="cid-badge2 ${cidPriorityTone(c.priorite)}">${esc(c.priorite || '-')}</span></strong></div>
        <div class="cid-chip"><span>Classification</span><strong>${esc(c.classification || '-')}</strong></div>
        <div class="cid-chip"><span>Confidentialite</span><strong>${esc(c.confidentialite || '-')}</strong></div>
      </div>
      <div class="cid-nav-tabs"><span class="active">Apercu</span><span>Personnes ${people.length}</span><span>Preuves ${proofs.length}</span><span>Chronologie</span><span>Notes</span><span>Carte</span><span>Journal</span></div>
      <div class="cid-detail-grid">
        <div class="cid-panel">
          <h3>Informations generales</h3>
          <div class="cid-info-grid">
            <div class="cid-field"><span>Type de dossier</span><strong>${esc(c.classification || '-')}</strong></div>
            <div class="cid-field"><span>Nature des faits</span><strong>${esc(c.nature || '-')}</strong></div>
            <div class="cid-field"><span>Lieu des faits</span><strong>${esc(c.lieu || '-')}</strong></div>
            <div class="cid-field"><span>Date des faits</span><strong>${esc(c.date_faits || '-')}</strong></div>
            <div class="cid-field"><span>Cree par</span><strong>${esc(c.responsable || '-')}</strong></div>
            <div class="cid-field"><span>Suspects</span><strong>${c.suspects || pc.Suspects}</strong></div>
          </div>
        </div>
        <div class="cid-panel">
          <h3>Resume du dossier</h3>
          <p class="cid-text">${esc(c.resume || c.description || 'Aucun resume renseigne.')}</p>
          <button class="cid-soft-btn" onclick="renderCIDCase('${c.id}')">Modifier</button>
        </div>
        <div class="cid-panel">
          <h3>Acces au dossier</h3>
          <div class="cid-field"><span>Niveau requis</span><strong>${esc(c.confidentialite || 'CID uniquement')}</strong></div>
          <div class="cid-field" style="margin-top:12px"><span>Membres affectes</span><strong>${esc(c.membres || c.responsable || '-')}</strong></div>
        </div>
      </div>
      <div class="cid-detail-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="cid-panel">
          <h3>Personnes</h3>
          <div class="cid-stat-grid">
            <div class="cid-stat-box"><b>${pc.Suspects}</b><span>Suspects</span></div>
            <div class="cid-stat-box"><b>${pc.Victimes}</b><span>Victimes</span></div>
            <div class="cid-stat-box"><b>${pc.Temoins}</b><span>Temoins</span></div>
            <div class="cid-stat-box"><b>${pc.Informateurs + pc.Enqueteurs}</b><span>Autres</span></div>
          </div>
          <table class="cid-mini-table" style="margin-top:12px"><tbody>${people.slice(0,4).map(function(p){return '<tr><td>'+esc(p.nom)+'</td><td><span class="cid-badge2 blue">'+esc(p.type)+'</span></td></tr>';}).join('') || '<tr><td>Aucune personne.</td></tr>'}</tbody></table>
        </div>
        <div class="cid-panel">
          <h3>Chronologie recente</h3>
          <div class="cid-timeline">${journal.slice(0,5).map(function(j){return '<div class="cid-time"><small>'+esc(j.date || '-')+'</small>'+esc(j.texte || '')+'</div>';}).join('') || '<div class="cid-time">Aucun historique.</div>'}</div>
        </div>
        <div class="cid-panel">
          <h3>Preuves recentes</h3>
          <table class="cid-mini-table"><thead><tr><th>Scelle</th><th>Type</th><th>Etat</th></tr></thead><tbody>${proofs.slice(0,5).map(function(e){return '<tr><td>'+esc(e.scelle || '-')+'</td><td>'+esc(e.type || '-')+'</td><td><span class="cid-badge2 gold">'+esc(e.etat || '-')+'</span></td></tr>';}).join('') || '<tr><td colspan="3">Aucune preuve.</td></tr>'}</tbody></table>
        </div>
      </div>
      <section class="cid-panel" style="margin-top:14px">
        <h3>Description complete</h3>
        <p class="cid-text">${esc(c.description || 'Aucune description complete.')}</p>
      </section>
    </section>`;
}

function renderCID3(){
  if (!canAccessCID()) {
    setContent('<div class="empty-state"><div class="empty-icon">CID</div><div class="empty-title">Acces restreint</div><div class="empty-sub">Role CID requis.</div></div>');
    return;
  }
  var list = cidLoad();
  var q = (S.pd && S.pd.q) || '';
  var filter = (S.pd && S.pd.filter) || 'Toutes';
  var visible = list.filter(function(c){
    var ok = filter === 'Toutes' || c.statut === filter;
    var hay = [c.numero, c.titre, c.statut, c.priorite, c.classification, c.responsable, c.resume].join(' ').toLowerCase();
    return ok && hay.indexOf(q.toLowerCase()) !== -1;
  }).sort(function(a,b){ return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
  var activeId = (S.pd && S.pd.id) || (visible[0] && visible[0].id);
  var active = activeId ? cidGet(activeId) : null;
  var openCount = list.filter(function(c){ return c.statut === 'Ouvert'; }).length;
  var waitCount = list.filter(function(c){ return c.statut === 'En attente'; }).length;
  var closedCount = list.filter(function(c){ return /ferme|classe/i.test(c.statut || ''); }).length;
  setContent(`
    <div class="cid-mdt">
      ${cidCss2()}
      <section class="cid-topbar">
        <div class="cid-brand"><div class="cid-brand-icon">CID</div><div><div class="cid-brand-title">CID</div><div class="cid-brand-sub">Criminal Investigation Division</div></div></div>
        <div class="cid-global-search"><input id="cidSearchInput" placeholder="Rechercher un dossier, une personne, une preuve..." value="${esc(q)}"><span class="cid-key">⌘ K</span></div>
        <div class="cid-session"><span class="cid-pill">Connecte a Discord <i class="cid-dot"></i></span><span class="cid-pill">Role requis: @CID <b class="cid-dot"></b></span></div>
      </section>
      <div class="cid-shell">
        <aside class="cid-list-pane">
          <div class="cid-pane-head"><div class="cid-pane-title">Dossiers d'enquete</div><button class="cid-blue-btn" onclick="cidOpenCreate()">+ Nouveau dossier</button></div>
          <div class="cid-filter-zone">
            <input id="cidSideSearch" placeholder="Rechercher..." value="${esc(q)}">
            <select id="cidFilterSelect"><option>Toutes</option>${cidOptions(CID_STATUTS, filter)}</select>
            <div class="cid-tabs"><button class="cid-tab ${filter==='Toutes'?'active':''}" onclick="navigate('cid',{filter:'Toutes',q:'${esc(q)}'})">Tous ${list.length}</button><button class="cid-tab" onclick="navigate('cid',{filter:'Ouvert',q:'${esc(q)}'})">Ouverts ${openCount}</button><button class="cid-tab" onclick="navigate('cid',{filter:'En attente',q:'${esc(q)}'})">En cours ${waitCount}</button><button class="cid-tab">Fermes ${closedCount}</button></div>
          </div>
          <div class="cid-case-list">
            ${visible.length ? visible.map(function(c){
              return "<article class=\"cid-case-card " + (active && active.id === c.id ? "active" : "") + "\" onclick='navigate(\"cid\",{id:" + JSON.stringify(c.id) + "})'><div class=\"cid-card-top\"><span>" + esc(c.numero || "CID") + "</span><span class=\"cid-badge2 " + cidPriorityTone(c.priorite) + "\">" + esc(c.priorite || "Normale") + "</span></div><div class=\"cid-case-name\">" + esc(c.titre || "Dossier sans titre") + "</div><div class=\"cid-case-meta\"><span>" + esc(c.responsable || "CID") + "</span><span>" + esc(c.updated_at || "-") + "</span></div></article>";
            }).join('') : '<div class="cid-empty-panel" style="min-height:220px">Aucun dossier.</div>'}
          </div>
          <div class="cid-footer-pages">1-${visible.length} sur ${list.length} dossiers</div>
        </aside>
        ${cidCaseWorkspace(active)}
      </div>
    </div>
  `);
  var search = document.getElementById('cidSearchInput');
  var sideSearch = document.getElementById('cidSideSearch');
  var select = document.getElementById('cidFilterSelect');
  function goSearch(value){ navigate('cid', {q: value, filter: select ? select.value : filter}); }
  if (search) search.addEventListener('change', function(){ goSearch(this.value); });
  if (sideSearch) sideSearch.addEventListener('change', function(){ goSearch(this.value); });
  if (select) select.addEventListener('change', function(){ navigate('cid', {filter: this.value, q: sideSearch ? sideSearch.value : q}); });
}

async function cidGetCidAgents(){
  try {
    var agents = await DB.getAgents({});
    return (agents || []).filter(function(a){
      return (a.unites || []).some(function(u){ return String(u).toUpperCase() === 'CID'; }) ||
        String(a.division || '').toUpperCase() === 'CID';
    }).sort(function(a,b){ return Number(a.matricule || 9999) - Number(b.matricule || 9999); });
  } catch(e) {
    return [];
  }
}

function cidArchive(id){
  var c = cidGet(id);
  if (!c) return;
  if (!confirm('Archiver ce dossier CID ?')) return;
  cidUpsert(Object.assign({}, c, {statut: 'Classe'}));
  navigate('cid', {id: id});
}

function cidDelete(id){
  if (!confirm('Supprimer definitivement ce dossier CID ?')) return;
  cidSave(cidLoad().filter(function(c){ return c.id !== id; }));
  navigate('cid');
}

function cidReadAttachment(file){
  return new Promise(function(resolve, reject){
    if (!file) return resolve(null);
    if (file.size > 4500000) return reject(new Error('Fichier trop lourd pour la sauvegarde locale CID.'));
    var reader = new FileReader();
    reader.onload = function(){
      resolve({name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: reader.result});
    };
    reader.onerror = function(){ reject(new Error('Lecture du fichier impossible.')); };
    reader.readAsDataURL(file);
  });
}

async function cidAddPerson(id){
  var c = cidGet(id);
  if (!c) return;
  var investigators = await cidGetCidAgents();
  var investigatorOptions = investigators.length
    ? investigators.map(function(a){
        var label = String(a.matricule || '--').padStart(2, '0') + ' - ' + (a.prenom || '') + ' ' + (a.nom || '') + ' - ' + (a.grade || 'CID');
        return '<option value="' + esc(label.trim()) + '">' + esc(label.trim()) + '</option>';
      }).join('')
    : '<option value="">Aucun agent CID trouve - saisie manuelle</option>';
  openModal({
    eyebrow: 'CID - Personne liee',
    title: 'Ajouter une personne',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidPersonForm" onsubmit="event.preventDefault();cidSavePersonModal('${id}')">
            <div class="cid-grid">
              <input name="nom" id="cidPersonName" placeholder="Nom / prenom" required>
              <select name="type" id="cidPersonType" onchange="cidToggleInvestigatorPicker()">${cidOptions(['Citoyen','Suspect','Victime','Temoin','Informateur','Agent infiltre','Enqueteur'], 'Suspect')}</select>
              <input name="tel" placeholder="Numero de telephone">
              <select name="danger">${cidOptions(['Inconnue','Faible','Moyenne','Elevee','Critique'], 'Inconnue')}</select>
              <select name="statut">${cidOptions(['Actif','A surveiller','Localise','Interroge','Archive'], 'Actif')}</select>
              <select id="cidInvestigatorSelect" style="display:none" onchange="cidPickInvestigator(this.value)">${investigatorOptions}</select>
            </div>
            <textarea name="commentaires" rows="4" placeholder="Commentaires CID" style="margin-top:10px"></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="btn" onclick="closeModal()">Annuler</button><button class="btn btn-primary" onclick="cidSavePersonModal(\'' + id + '\')">Ajouter</button>'
  });
}

function cidToggleInvestigatorPicker(){
  var type = document.getElementById('cidPersonType');
  var picker = document.getElementById('cidInvestigatorSelect');
  if (!type || !picker) return;
  var show = type.value === 'Enqueteur';
  picker.style.display = show ? '' : 'none';
  if (show && picker.value) cidPickInvestigator(picker.value);
}

function cidPickInvestigator(value){
  var input = document.getElementById('cidPersonName');
  if (input && value) input.value = value;
}

function cidSavePersonModal(id){
  var c = cidGet(id), f = document.getElementById('cidPersonForm');
  if (!c || !f) return;
  var fd = new FormData(f);
  var nom = fd.get('nom');
  if (!nom) return toast('Nom requis.');
  c.personnes = c.personnes || [];
  var person = {
    id: 'p_' + Date.now(),
    nom: nom,
    type: fd.get('type') || 'Citoyen',
    tel: fd.get('tel') || '',
    danger: fd.get('danger') || 'Inconnue',
    statut: fd.get('statut') || 'Actif',
    commentaires: fd.get('commentaires') || '',
    fichiers: []
  };
  c.personnes.push(person);
  c.suspects = c.personnes.filter(function(p){ return /suspect/i.test(p.type); }).length;
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Personne ajoutee : ' + nom});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id: id, person: person.id});
}

async function cidAddProof(id){
  var c = cidGet(id);
  if (!c) return;
  openModal({
    eyebrow: 'CID - Preuve',
    title: 'Ajouter une preuve',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidProofForm" onsubmit="event.preventDefault();cidSaveProofModal('${id}')">
            <div class="cid-grid">
              <select name="type">${cidOptions(['Document','Photo','Video','Audio','Arme','Objet','ADN','Temoignage','Telephone','Autre'], 'Photo')}</select>
              <input name="decouvert_par" placeholder="Ajoute par" value="${esc(S.serverNick || 'CID')}">
              <select name="etat">${cidOptions(['Inventorie','Analyse en cours','Exploitee','Archivee'], 'Inventorie')}</select>
              <input name="localisation" placeholder="Localisation / stockage" value="CID">
              <input name="fichier" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt">
            </div>
            <textarea name="description" rows="4" placeholder="Description de la preuve" style="margin-top:10px"></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidSaveProofModal(\'' + id + '\')">Ajouter</button>'
  });
}

async function cidSaveProofModal(id){
  var c = cidGet(id), f = document.getElementById('cidProofForm');
  if (!c || !f) return;
  var fd = new FormData(f);
  var file = f.querySelector('input[type="file"]');
  var attachment = null;
  try {
    attachment = await cidReadAttachment(file && file.files && file.files[0]);
  } catch(e) {
    return toast(e.message);
  }
  c.preuves = c.preuves || [];
  var seal = 'SC-' + new Date().getFullYear() + '-' + String(c.preuves.length + 1).padStart(4, '0');
  c.preuves.push({
    id: 'e_' + Date.now(),
    scelle: seal,
    codebarres: seal.replace(/\D/g, '') + Date.now().toString().slice(-4),
    type: fd.get('type') || 'Autre',
    description: fd.get('description') || '',
    lieu: '',
    date: cidNow(),
    decouvert_par: fd.get('decouvert_par') || S.serverNick || 'CID',
    etat: fd.get('etat') || 'Inventorie',
    localisation: fd.get('localisation') || 'CID',
    attachment: attachment,
    chaine: [{date: cidNow(), texte: 'Ajout au dossier'}]
  });
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Preuve ajoutee : ' + seal});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id: id});
}

function cidOpenPersonFile(id, pid){
  openModal({
    eyebrow: 'CID - Fiche personne',
    title: 'Ajouter un fichier',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidPersonFileForm" onsubmit="event.preventDefault();cidSavePersonFile('${id}','${pid}')">
            <div class="cid-grid">
              <select name="type">${cidOptions(['Photo','Video','Audio','Document','Autre'], 'Photo')}</select>
              <input name="fichier" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" required>
            </div>
            <textarea name="note" rows="3" placeholder="Note sur le fichier" style="margin-top:10px"></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidSavePersonFile(\'' + id + '\',\'' + pid + '\')">Ajouter</button>'
  });
}

async function cidSavePersonFile(id, pid){
  var c = cidGet(id), f = document.getElementById('cidPersonFileForm');
  var p = c && (c.personnes || []).find(function(x){ return x.id === pid; });
  if (!c || !p || !f) return;
  var file = f.querySelector('input[type="file"]');
  var fd = new FormData(f);
  var attachment = null;
  try {
    attachment = await cidReadAttachment(file && file.files && file.files[0]);
  } catch(e) {
    return toast(e.message);
  }
  p.fichiers = p.fichiers || [];
  p.fichiers.unshift({id:'pf_' + Date.now(), type:fd.get('type') || 'Photo', note:fd.get('note') || '', date:cidNow(), attachment:attachment});
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Fichier ajoute sur la fiche personne : ' + p.nom});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id:id, person:pid});
}

function cidSavePersonProfile(id, pid){
  var c = cidGet(id), f = document.getElementById('cidPersonProfileForm');
  var p = c && (c.personnes || []).find(function(x){ return x.id === pid; });
  if (!c || !p || !f) return;
  var fd = new FormData(f);
  p.nom = fd.get('nom') || p.nom;
  p.type = fd.get('type') || p.type;
  p.tel = fd.get('tel') || '';
  p.danger = fd.get('danger') || 'Inconnue';
  p.statut = fd.get('statut') || 'Actif';
  p.commentaires = fd.get('commentaires') || '';
  c.suspects = (c.personnes || []).filter(function(x){ return /suspect/i.test(x.type); }).length;
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Fiche personne modifiee : ' + p.nom});
  cidUpsert(c);
  toast('Fiche personne sauvegardee.');
  navigate('cid', {id:id, person:pid});
}

function cidDeletePerson(id, pid){
  var c = cidGet(id);
  if (!c) return;
  if (!confirm('Supprimer cette personne du dossier ?')) return;
  c.personnes = (c.personnes || []).filter(function(p){ return p.id !== pid; });
  c.suspects = c.personnes.filter(function(p){ return /suspect/i.test(p.type); }).length;
  cidUpsert(c);
  navigate('cid', {id:id});
}

function cidAttachmentHtml(file, label){
  if (!file || !file.data) return '<span>-</span>';
  var name = esc(label || file.name || 'Fichier');
  if (String(file.type || '').indexOf('image/') === 0) return '<a href="' + file.data + '" target="_blank"><img src="' + file.data + '" alt="' + name + '" style="width:72px;height:48px;object-fit:cover;border-radius:6px;border:1px solid rgba(80,122,170,.35)"></a>';
  return '<a href="' + file.data + '" target="_blank" class="cid-badge2 blue">' + name + '</a>';
}

function cidPersonWorkspace(c, pid){
  var p = c && (c.personnes || []).find(function(x){ return x.id === pid; });
  if (!c || !p) return cidCaseWorkspace(c);
  var files = p.fichiers || [];
  return `
    <section class="cid-workspace">
      <button class="cid-return" onclick="navigate('cid',{id:'${c.id}'})">Retour au dossier</button>
      <div class="cid-case-head">
        <div>
          <div class="cid-case-id">${esc(c.numero || 'CID')} - Fiche personne</div>
          <h1 class="cid-case-title">${esc(p.nom || 'Personne')}</h1>
          <div class="cid-subline"><span>${esc(p.type || '-')}</span><span>${esc(p.statut || '-')}</span><span>Dangerosite: ${esc(p.danger || '-')}</span></div>
        </div>
        <div class="cid-actions">
          <button class="cid-gold-btn" onclick="cidOpenPersonFile('${c.id}','${p.id}')">Ajouter fichier</button>
          <button class="cid-red-btn" onclick="cidDeletePerson('${c.id}','${p.id}')">Supprimer</button>
        </div>
      </div>
      <div class="cid-detail-grid" style="grid-template-columns:1fr 1fr">
        <section class="cid-panel">
          <h3>Identite</h3>
          <form id="cidPersonProfileForm" onsubmit="event.preventDefault();cidSavePersonProfile('${c.id}','${p.id}')">
            <div class="cid-info-grid">
              <input name="nom" value="${esc(p.nom || '')}" placeholder="Nom / prenom">
              <select name="type">${cidOptions(['Citoyen','Suspect','Victime','Temoin','Informateur','Agent infiltre','Enqueteur'], p.type || 'Citoyen')}</select>
              <input name="tel" value="${esc(p.tel || '')}" placeholder="Telephone">
              <select name="danger">${cidOptions(['Inconnue','Faible','Moyenne','Elevee','Critique'], p.danger || 'Inconnue')}</select>
              <select name="statut">${cidOptions(['Actif','A surveiller','Localise','Interroge','Archive'], p.statut || 'Actif')}</select>
            </div>
            <textarea name="commentaires" rows="7" style="margin-top:10px" placeholder="Notes, habitudes, signalement, liens...">${esc(p.commentaires || '')}</textarea>
            <button class="cid-blue-btn" style="margin-top:10px">Sauvegarder</button>
          </form>
        </section>
        <section class="cid-panel">
          <h3>Photos / fichiers</h3>
          <div class="cid-mini-list">${files.length ? files.map(function(f){
            return '<div class="cid-mini" style="display:flex;gap:10px;align-items:center">' + cidAttachmentHtml(f.attachment, f.type) + '<div><strong>'+esc(f.type || 'Fichier')+'</strong><br><small>'+esc(f.date || '-')+'</small><br>'+esc(f.note || '')+'</div></div>';
          }).join('') : '<div class="cid-mini">Aucun fichier sur cette fiche.</div>'}</div>
        </section>
      </div>
    </section>`;
}

function cidCaseWorkspace(c){
  if (!c) {
    return '<section class="cid-workspace cid-empty-panel"><div><div class="cid-brand-icon" style="margin:0 auto 12px">CID</div><h2>Aucun dossier selectionne</h2><p>Creer ou selectionner un dossier pour ouvrir le poste de travail.</p></div></section>';
  }
  var pc = cidPersonTypeCounts(c);
  var proofs = c.preuves || [];
  var people = c.personnes || [];
  return `
    <section class="cid-workspace">
      <button class="cid-return" onclick="navigate('cid')">Retour aux dossiers</button>
      <div class="cid-case-head">
        <div>
          <div class="cid-case-id">${esc(c.numero || 'CID')}</div>
          <h1 class="cid-case-title">${esc(c.titre || 'Dossier sans titre')}</h1>
          <div class="cid-subline"><span>Ouvert le ${esc(c.date_ouverture || '-')}</span><span>Derniere modif. ${esc(c.updated_at || '-')}</span><span>Par ${esc(c.responsable || 'CID')}</span></div>
        </div>
        <div class="cid-actions">
          <button class="cid-soft-btn" onclick="renderCIDCase('${c.id}')">Modifier</button>
          <button class="cid-soft-btn" onclick="cidAddLog('${c.id}')">Note</button>
          <button class="cid-blue-btn" onclick="cidAddPerson('${c.id}')">Personne</button>
          <button class="cid-gold-btn" onclick="cidAddProof('${c.id}')">Preuve</button>
          <button class="cid-soft-btn" onclick="cidArchive('${c.id}')">Archiver</button>
          <button class="cid-red-btn" onclick="cidDelete('${c.id}')">Supprimer</button>
        </div>
      </div>
      <div class="cid-summary-chips" style="margin-top:14px">
        <div class="cid-chip"><span>Statut</span><strong><span class="cid-badge2 ${cidStatusTone(c.statut)}">${esc(c.statut || '-')}</span></strong></div>
        <div class="cid-chip"><span>Priorite</span><strong><span class="cid-badge2 ${cidPriorityTone(c.priorite)}">${esc(c.priorite || '-')}</span></strong></div>
        <div class="cid-chip"><span>Classification</span><strong>${esc(c.classification || '-')}</strong></div>
        <div class="cid-chip"><span>Confidentialite</span><strong>${esc(c.confidentialite || '-')}</strong></div>
      </div>
      <div class="cid-detail-grid">
        <div class="cid-panel">
          <h3>Informations generales</h3>
          <div class="cid-info-grid">
            <div class="cid-field"><span>Type de dossier</span><strong>${esc(c.classification || '-')}</strong></div>
            <div class="cid-field"><span>Nature des faits</span><strong>${esc(c.nature || '-')}</strong></div>
            <div class="cid-field"><span>Cree par</span><strong>${esc(c.responsable || '-')}</strong></div>
            <div class="cid-field"><span>Suspects</span><strong>${c.suspects || pc.Suspects}</strong></div>
          </div>
        </div>
        <div class="cid-panel">
          <h3>Resume du dossier</h3>
          <p class="cid-text">${esc(c.resume || c.description || 'Aucun resume renseigne.')}</p>
        </div>
        <div class="cid-panel">
          <h3>Acces au dossier</h3>
          <div class="cid-field"><span>Niveau requis</span><strong>${esc(c.confidentialite || 'CID uniquement')}</strong></div>
          <div class="cid-field" style="margin-top:12px"><span>Membres affectes</span><strong>${esc(c.membres || c.responsable || '-')}</strong></div>
        </div>
      </div>
      <div class="cid-detail-grid" style="grid-template-columns:1fr 1fr">
        <div class="cid-panel">
          <h3>Personnes</h3>
          <div class="cid-stat-grid">
            <div class="cid-stat-box"><b>${pc.Suspects}</b><span>Suspects</span></div>
            <div class="cid-stat-box"><b>${pc.Victimes}</b><span>Victimes</span></div>
            <div class="cid-stat-box"><b>${pc.Temoins}</b><span>Temoins</span></div>
            <div class="cid-stat-box"><b>${pc.Informateurs + pc.Enqueteurs}</b><span>Autres</span></div>
          </div>
          <table class="cid-mini-table" style="margin-top:12px"><tbody>${people.length ? people.map(function(p){return "<tr style=\"cursor:pointer\" onclick='navigate(\"cid\",{id:" + JSON.stringify(c.id) + ",person:" + JSON.stringify(p.id) + "})'><td><strong>"+esc(p.nom)+"</strong></td><td><span class=\"cid-badge2 blue\">"+esc(p.type)+"</span></td><td>"+esc(p.tel || "-")+"</td></tr>";}).join('') : '<tr><td>Aucune personne.</td></tr>'}</tbody></table>
        </div>
        <div class="cid-panel">
          <h3>Preuves</h3>
          <table class="cid-mini-table"><thead><tr><th>Apercu</th><th>Scelle</th><th>Type</th><th>Etat</th></tr></thead><tbody>${proofs.length ? proofs.map(function(e){return '<tr><td>'+cidAttachmentHtml(e.attachment, e.type)+'</td><td>'+esc(e.scelle || '-')+'</td><td>'+esc(e.type || '-')+'</td><td><span class="cid-badge2 gold">'+esc(e.etat || '-')+'</span></td></tr>';}).join('') : '<tr><td colspan="4">Aucune preuve.</td></tr>'}</tbody></table>
        </div>
      </div>
      <section class="cid-panel" style="margin-top:14px">
        <h3>Description complete</h3>
        <p class="cid-text">${esc(c.description || 'Aucune description complete.')}</p>
      </section>
    </section>`;
}

async function renderCID3(){
  if (!canAccessCID()) {
    setContent('<div class="empty-state"><div class="empty-icon">CID</div><div class="empty-title">Acces restreint</div><div class="empty-sub">Role CID requis.</div></div>');
    return;
  }
  var list = cidLoad();
  var q = (S.pd && S.pd.q) || '';
  var filter = (S.pd && S.pd.filter) || 'Toutes';
  var visible = list.filter(function(c){
    var ok = filter === 'Toutes' || c.statut === filter;
    var peopleHay = (c.personnes || []).map(function(p){ return [p.nom,p.type,p.tel].join(' '); }).join(' ');
    var proofsHay = (c.preuves || []).map(function(p){ return [p.scelle,p.type,p.description].join(' '); }).join(' ');
    var hay = [c.numero, c.titre, c.statut, c.priorite, c.classification, c.responsable, c.resume, peopleHay, proofsHay].join(' ').toLowerCase();
    return ok && hay.indexOf(q.toLowerCase()) !== -1;
  }).sort(function(a,b){ return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
  var activeId = (S.pd && S.pd.id) || (visible[0] && visible[0].id);
  var active = activeId ? cidGet(activeId) : null;
  var openCount = list.filter(function(c){ return c.statut === 'Ouvert'; }).length;
  var waitCount = list.filter(function(c){ return c.statut === 'En attente'; }).length;
  var closedCount = list.filter(function(c){ return /ferme|classe/i.test(c.statut || ''); }).length;
  setContent(`
    <div class="cid-mdt">
      ${cidCss2()}
      <section class="cid-topbar">
        <div class="cid-brand"><div class="cid-brand-icon">CID</div><div><div class="cid-brand-title">CID</div><div class="cid-brand-sub">Criminal Investigation Division</div></div></div>
        <div class="cid-global-search"><input id="cidSearchInput" placeholder="Rechercher un dossier, une personne, une preuve..." value="${esc(q)}"><span class="cid-key">CTRL K</span></div>
        <div class="cid-session"><span class="cid-pill">Connecte Discord <i class="cid-dot"></i></span><span class="cid-pill">Acces CID <b class="cid-dot"></b></span></div>
      </section>
      <div class="cid-shell">
        <aside class="cid-list-pane">
          <div class="cid-pane-head"><div class="cid-pane-title">Dossiers</div><button class="cid-blue-btn" onclick="cidOpenCreate()">Nouveau</button></div>
          <div class="cid-filter-zone">
            <input id="cidSideSearch" placeholder="Rechercher..." value="${esc(q)}">
            <select id="cidFilterSelect"><option>Toutes</option>${cidOptions(CID_STATUTS, filter)}</select>
            <div class="cid-tabs"><button class="cid-tab ${filter==='Toutes'?'active':''}" onclick="navigate('cid',{filter:'Toutes',q:'${esc(q)}'})">Tous ${list.length}</button><button class="cid-tab" onclick="navigate('cid',{filter:'Ouvert',q:'${esc(q)}'})">Ouverts ${openCount}</button><button class="cid-tab" onclick="navigate('cid',{filter:'En attente',q:'${esc(q)}'})">Attente ${waitCount}</button><button class="cid-tab" onclick="navigate('cid',{filter:'Classe',q:'${esc(q)}'})">Archives ${closedCount}</button></div>
          </div>
          <div class="cid-case-list">
            ${visible.length ? visible.map(function(c){
              return "<article class=\"cid-case-card " + (active && active.id === c.id ? "active" : "") + "\" onclick='navigate(\"cid\",{id:" + JSON.stringify(c.id) + "})'><div class=\"cid-card-top\"><span>" + esc(c.numero || "CID") + "</span><span class=\"cid-badge2 " + cidPriorityTone(c.priorite) + "\">" + esc(c.priorite || "Normale") + "</span></div><div class=\"cid-case-name\">" + esc(c.titre || "Dossier sans titre") + "</div><div class=\"cid-case-meta\"><span>" + esc(c.responsable || "CID") + "</span><span>" + esc(c.updated_at || "-") + "</span></div></article>";
            }).join('') : '<div class="cid-empty-panel" style="min-height:220px">Aucun dossier.</div>'}
          </div>
          <div class="cid-footer-pages">1-${visible.length} sur ${list.length} dossiers</div>
        </aside>
        ${(S.pd && S.pd.person) ? cidPersonWorkspace(active, S.pd.person) : cidCaseWorkspace(active)}
      </div>
    </div>
  `);
  var search = document.getElementById('cidSearchInput');
  var sideSearch = document.getElementById('cidSideSearch');
  var select = document.getElementById('cidFilterSelect');
  function goSearch(value){ navigate('cid', {q: value, filter: select ? select.value : filter}); }
  if (search) search.addEventListener('change', function(){ goSearch(this.value); });
  if (sideSearch) sideSearch.addEventListener('change', function(){ goSearch(this.value); });
  if (select) select.addEventListener('change', function(){ navigate('cid', {filter: this.value, q: sideSearch ? sideSearch.value : q}); });
}

function cidCss2(){
  return `<style>
    .cid-mdt,.cid-page{display:grid;gap:14px;color:#dbeafe;font-size:13px}.cid-mdt *,.cid-page *{box-sizing:border-box}.cid-card{background:linear-gradient(145deg,rgba(11,24,43,.96),rgba(8,16,29,.98));border:1px solid rgba(79,117,160,.34);border-radius:8px;padding:14px;box-shadow:0 16px 42px rgba(0,0,0,.2)}
    .cid-topbar,.cid-list-pane,.cid-workspace,.cid-panel{background:linear-gradient(145deg,rgba(11,24,43,.96),rgba(8,16,29,.98));border:1px solid rgba(79,117,160,.34);border-radius:8px;box-shadow:0 16px 42px rgba(0,0,0,.2)}
    .cid-topbar{display:grid;grid-template-columns:1fr minmax(280px,520px) auto;gap:14px;align-items:center;padding:12px 14px}.cid-brand{display:flex;align-items:center;gap:12px}.cid-brand-icon{width:34px;height:34px;border:1px solid rgba(75,140,255,.32);border-radius:8px;display:grid;place-items:center;background:rgba(15,30,52,.85);color:#7db4ff;font-weight:800}.cid-brand-title{font-size:17px;font-weight:800}.cid-brand-sub{font-size:11px;color:#8ea8c8}
    .cid-global-search{position:relative}.cid-global-search input{width:100%;background:#07111f;border:1px solid rgba(80,122,170,.35);border-radius:7px;color:#dbeafe;padding:11px 42px 11px 34px}.cid-global-search:before{content:'?';position:absolute;left:13px;top:9px;color:#7fa8d6}.cid-key{position:absolute;right:8px;top:8px;border:1px solid rgba(126,162,208,.28);border-radius:5px;padding:3px 8px;color:#93a9c4;font-size:10px;background:rgba(255,255,255,.04)}
    .cid-session{display:flex;gap:8px;align-items:center;justify-content:flex-end}.cid-pill{display:inline-flex;align-items:center;gap:7px;border:1px solid rgba(78,117,161,.35);border-radius:7px;background:rgba(9,18,34,.82);padding:8px 10px;color:#c9dcf5;font-size:11px}.cid-dot{width:7px;height:7px;border-radius:50%;background:#20df78}
    .cid-shell{display:grid;grid-template-columns:330px minmax(0,1fr);gap:14px;min-height:690px}.cid-list-pane{display:grid;grid-template-rows:auto auto 1fr auto;overflow:hidden}.cid-pane-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-bottom:1px solid rgba(82,120,166,.22)}.cid-pane-title{font-size:16px;font-weight:800}
    .cid-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.cid-blue-btn,.cid-gold-btn,.cid-soft-btn,.cid-red-btn{border-radius:6px;padding:7px 10px;font-size:11px;letter-spacing:.02em;font-weight:600;cursor:pointer;background:rgba(7,16,30,.72);line-height:1.1}.cid-blue-btn{color:#8fbaff;border:1px solid rgba(75,145,255,.42)}.cid-gold-btn{color:#f2cd55;border:1px solid rgba(214,179,68,.5)}.cid-soft-btn{color:#bfd8fb;border:1px solid rgba(83,125,175,.35)}.cid-red-btn{color:#ff7676;border:1px solid rgba(255,90,90,.42)}
    .cid-filter-zone{padding:12px 14px;display:grid;gap:9px;border-bottom:1px solid rgba(82,120,166,.18)}.cid-filter-zone input,.cid-filter-zone select,.cid-panel input,.cid-panel select,.cid-panel textarea,.cid-card input,.cid-card select,.cid-card textarea{width:100%;background:#07111f;border:1px solid rgba(80,122,170,.42);border-radius:7px;color:#dbeafe;padding:10px;outline:none;color-scheme:dark}.cid-panel textarea,.cid-card textarea{resize:vertical;min-height:96px}.cid-panel input[type=file],.cid-card input[type=file]{padding:8px;color:#9fbce0}.cid-panel input[type=file]::file-selector-button,.cid-card input[type=file]::file-selector-button{background:#10223b;color:#dbeafe;border:1px solid rgba(80,122,170,.42);border-radius:6px;padding:6px 9px;margin-right:10px}
    .cid-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.cid-grid input,.cid-grid select{min-width:0}
    .cid-tabs{display:flex;gap:6px;overflow:auto}.cid-tab{font-size:11px;border:0;background:transparent;color:#8ea8c8;padding:7px 9px;border-radius:6px;cursor:pointer}.cid-tab.active{background:rgba(23,105,255,.12);color:#6fb2ff}
    .cid-case-list{padding:10px;overflow:auto;display:grid;gap:8px;align-content:start}.cid-case-card{border:1px solid rgba(74,114,159,.26);background:rgba(7,16,30,.78);border-radius:7px;padding:11px;cursor:pointer;transition:.15s}.cid-case-card:hover,.cid-case-card.active{border-color:#2d86ff;background:linear-gradient(135deg,rgba(14,37,68,.96),rgba(7,17,31,.96));box-shadow:inset 3px 0 #2d86ff}.cid-card-top,.cid-case-meta{display:flex;justify-content:space-between;gap:8px;color:#8ea8c8;font-size:11px}.cid-case-name{margin:7px 0 4px;font-size:13px;font-weight:800;color:#eef6ff}.cid-footer-pages{padding:12px 14px;border-top:1px solid rgba(82,120,166,.18);color:#8ea8c8;font-size:12px}
    .cid-badge2{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:700;border:1px solid rgba(130,162,206,.22);background:rgba(255,255,255,.04);color:#bdd6f9}.cid-badge2.red{color:#ff6666;background:rgba(255,54,54,.12);border-color:rgba(255,74,74,.25)}.cid-badge2.orange{color:#ffb44f;background:rgba(255,144,48,.12);border-color:rgba(255,171,68,.25)}.cid-badge2.blue{color:#62a8ff;background:rgba(47,124,255,.12);border-color:rgba(75,145,255,.28)}.cid-badge2.green{color:#48e58b;background:rgba(36,210,109,.12);border-color:rgba(56,220,132,.28)}.cid-badge2.gold{color:#f2cd55;background:rgba(214,179,68,.13);border-color:rgba(214,179,68,.32)}
    .cid-workspace{padding:14px;overflow:auto}.cid-return{border:0;background:transparent;color:#8ea8c8;cursor:pointer;margin-bottom:12px;font-size:12px}.cid-case-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:start;border-bottom:1px solid rgba(82,120,166,.2);padding-bottom:13px}.cid-case-id{font-size:12px;color:#91b4df}.cid-case-title{font-size:21px;font-weight:800;margin:5px 0}.cid-subline{display:flex;gap:12px;flex-wrap:wrap;color:#91a9c5;font-size:12px}.cid-summary-chips{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin-top:12px}.cid-chip{border:1px solid rgba(76,112,154,.28);background:rgba(9,18,34,.65);border-radius:8px;padding:9px}.cid-chip span{display:block;color:#8aa2c0;font-size:10px}.cid-chip strong{display:block;margin-top:4px;color:#fff;font-size:12px}
    .cid-detail-grid{display:grid;grid-template-columns:1.1fr 1fr .9fr;gap:12px;margin-top:12px}.cid-panel{padding:13px}.cid-panel h3{margin:0 0 10px;font-size:14px;font-weight:800}.cid-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cid-field span{display:block;color:#7f96b3;font-size:10px;margin-bottom:3px}.cid-field strong{color:#edf6ff;font-size:12px}.cid-text{color:#c7d8ef;line-height:1.5;font-size:12px}.cid-mini-list{display:grid;gap:8px}.cid-mini{border:1px solid rgba(80,122,170,.24);border-radius:7px;background:rgba(7,16,30,.62);padding:10px}.cid-mini-table{width:100%;border-collapse:collapse}.cid-mini-table th,.cid-mini-table td{border-bottom:1px solid rgba(82,120,166,.18);padding:9px;text-align:left;font-size:12px}.cid-mini-table th{color:#8ca6c7;font-size:10px;text-transform:uppercase;letter-spacing:.12em}.cid-empty-panel{display:grid;place-items:center;min-height:400px;text-align:center;color:#8ea8c8}.cid-preview-img{width:76px;height:52px;object-fit:cover;border-radius:6px;border:1px solid rgba(80,122,170,.35);cursor:pointer}.cid-hidden{display:none!important}
    @media(max-width:1200px){.cid-shell{grid-template-columns:1fr}.cid-detail-grid{grid-template-columns:1fr}.cid-topbar{grid-template-columns:1fr}.cid-summary-chips{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.cid-summary-chips,.cid-info-grid{grid-template-columns:1fr}.cid-case-head{grid-template-columns:1fr}}
  </style>`;
}

function cidOpenEditCase(id){
  var c = cidGet(id);
  if (!c) return;
  openModal({
    eyebrow: 'CID - Dossier',
    title: 'Modifier le dossier',
    size: 'xl',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidCaseEditForm" onsubmit="event.preventDefault();cidSaveCaseModal('${id}')">
            <div class="cid-grid">
              <input name="titre" value="${esc(c.titre || '')}" placeholder="Titre du dossier" required>
              <select name="statut">${cidOptions(CID_STATUTS, c.statut || 'Ouvert')}</select>
              <select name="priorite">${cidOptions(CID_PRIORITES, c.priorite || 'Normale')}</select>
              <select name="classification">${cidOptions(CID_CLASSIFICATIONS, c.classification || 'Autre')}</select>
            </div>
            <textarea name="resume" rows="3" placeholder="Resume rapide" style="margin-top:10px">${esc(c.resume || '')}</textarea>
            <textarea name="description" rows="6" placeholder="Description complete" style="margin-top:10px">${esc(c.description || '')}</textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidSaveCaseModal(\'' + id + '\')">Sauvegarder</button>'
  });
}

function cidSaveCaseModal(id){
  var c = cidGet(id), f = document.getElementById('cidCaseEditForm');
  if (!c || !f) return;
  var fd = new FormData(f);
  cidUpsert(Object.assign({}, c, {
    titre: fd.get('titre') || c.titre,
    statut: fd.get('statut') || c.statut,
    priorite: fd.get('priorite') || c.priorite,
    classification: fd.get('classification') || c.classification,
    resume: fd.get('resume') || '',
    description: fd.get('description') || ''
  }));
  closeModal();
  navigate('cid', {id:id});
}

function cidProofTypeChange(){
  var type = (document.getElementById('cidProofType') || {}).value || '';
  ['Arme','Drogue','Vehicule'].forEach(function(k){
    var box = document.getElementById('cidProof' + k);
    if (box) box.classList.toggle('cid-hidden', type !== k);
  });
  var fileWrap = document.getElementById('cidProofFileWrap');
  var needsFile = ['Photo','Document','ADN','Douille','Empreinte'].indexOf(type) !== -1;
  if (fileWrap) fileWrap.classList.toggle('cid-hidden', !needsFile);
}

function cidSuspectOptions(c){
  var suspects = (c.personnes || []).filter(function(p){ return /suspect/i.test(p.type || ''); });
  return '<option value="">Non attribue</option>' + suspects.map(function(p){ return '<option value="' + esc(p.id) + '">' + esc(p.nom || 'Suspect') + '</option>'; }).join('');
}

async function cidAddProof(id){
  var c = cidGet(id);
  if (!c) return;
  var suspects = cidSuspectOptions(c);
  openModal({
    eyebrow: 'CID - Preuve',
    title: 'Ajouter une saisie / preuve',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidProofForm" onsubmit="event.preventDefault();cidSaveProofModal('${id}')">
            <div class="cid-grid">
              <select name="type" id="cidProofType" onchange="cidProofTypeChange()">${cidOptions(['Photo','Document','ADN','Douille','Empreinte','Arme','Drogue','Vehicule','Objet','Telephone','Temoignage','Autre'], 'Photo')}</select>
              <div id="cidProofFileWrap"><input name="fichier" type="file" accept="image/*,.pdf,.doc,.docx,.txt"></div>
            </div>
            <div id="cidProofArme" class="cid-grid cid-hidden" style="margin-top:10px">
              <input name="type_arme" placeholder="Type d'arme">
              <input name="numero_serie" placeholder="Numero de serie">
              <select name="suspect_arme">${suspects}</select>
            </div>
            <div id="cidProofDrogue" class="cid-grid cid-hidden" style="margin-top:10px">
              <input name="type_drogue" placeholder="Type de drogue">
              <input name="quantite_drogue" placeholder="Quantite">
              <select name="suspect_drogue">${suspects}</select>
            </div>
            <div id="cidProofVehicule" class="cid-grid cid-hidden" style="margin-top:10px">
              <input name="modele_vehicule" placeholder="Modele du vehicule">
              <input name="plaque_vehicule" placeholder="Plaque">
              <select name="suspect_vehicule">${suspects}</select>
            </div>
            <textarea name="description" rows="4" placeholder="Description / contexte de la saisie" style="margin-top:10px"></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidSaveProofModal(\'' + id + '\')">Ajouter</button>'
  });
  cidProofTypeChange();
}

async function cidSaveProofModal(id){
  var c = cidGet(id), f = document.getElementById('cidProofForm');
  if (!c || !f) return;
  var fd = new FormData(f);
  var type = fd.get('type') || 'Autre';
  var file = f.querySelector('input[type="file"]');
  var attachment = null;
  try {
    attachment = await cidReadAttachment(file && file.files && file.files[0]);
  } catch(e) {
    return toast(e.message);
  }
  var details = {};
  if (type === 'Arme') details = {type_arme:fd.get('type_arme') || '', numero_serie:fd.get('numero_serie') || '', suspect_id:fd.get('suspect_arme') || ''};
  if (type === 'Drogue') details = {type_drogue:fd.get('type_drogue') || '', quantite:fd.get('quantite_drogue') || '', suspect_id:fd.get('suspect_drogue') || ''};
  if (type === 'Vehicule') details = {modele:fd.get('modele_vehicule') || '', plaque:fd.get('plaque_vehicule') || '', suspect_id:fd.get('suspect_vehicule') || ''};
  c.preuves = c.preuves || [];
  var seal = 'SC-' + new Date().getFullYear() + '-' + String(c.preuves.length + 1).padStart(4, '0');
  c.preuves.push({
    id: 'e_' + Date.now(),
    scelle: seal,
    codebarres: seal.replace(/\D/g, '') + Date.now().toString().slice(-4),
    type: type,
    description: fd.get('description') || '',
    details: details,
    date: cidNow(),
    etat: 'Inventorie',
    attachment: attachment,
    chaine: [{date: cidNow(), texte: 'Ajout au dossier'}]
  });
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Preuve ajoutee : ' + seal});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id: id});
}

function cidPreviewAttachment(file){
  if (!file || !file.data) return;
  var body = '<div style="text-align:center">';
  if (String(file.type || '').indexOf('image/') === 0) {
    body += '<img src="' + file.data + '" style="max-width:100%;max-height:70vh;border-radius:8px;border:1px solid rgba(80,122,170,.35)">';
  } else if (String(file.type || '').indexOf('video/') === 0) {
    body += '<video controls src="' + file.data + '" style="max-width:100%;max-height:70vh;border-radius:8px"></video>';
  } else if (String(file.type || '').indexOf('audio/') === 0) {
    body += '<audio controls src="' + file.data + '" style="width:100%"></audio>';
  } else {
    body += '<a class="cid-blue-btn" download="' + esc(file.name || 'preuve') + '" href="' + file.data + '">Telecharger le fichier</a>';
  }
  body += '</div>';
  openModal({eyebrow:'CID - Piece jointe', title:file.name || 'Apercu', size:'xl', body:body, footer:'<button class="cid-soft-btn" onclick="closeModal()">Fermer</button>'});
}

function cidEvidencePreview(id, eid){
  var c = cidGet(id);
  var e = c && (c.preuves || []).find(function(x){ return x.id === eid; });
  if (e) cidPreviewAttachment(e.attachment);
}

function cidPersonFilePreview(id, pid, fid){
  var c = cidGet(id);
  var p = c && (c.personnes || []).find(function(x){ return x.id === pid; });
  var f = p && (p.fichiers || []).find(function(x){ return x.id === fid; });
  if (f) cidPreviewAttachment(f.attachment);
}

function cidAttachmentHtml(file, label, onclick){
  if (!file || !file.data) return '<span>-</span>';
  var name = esc(label || file.name || 'Fichier');
  if (String(file.type || '').indexOf('image/') === 0) return '<img onclick="' + onclick + '" src="' + file.data + '" alt="' + name + '" class="cid-preview-img">';
  return '<button class="cid-soft-btn" onclick="' + onclick + '">' + name + '</button>';
}

function cidAddPerson(id){
  var c = cidGet(id);
  if (!c) return;
  cidGetCidAgents().then(function(investigators){
    var investigatorOptions = investigators.length
      ? investigators.map(function(a){
          var label = String(a.matricule || '--').padStart(2, '0') + ' - ' + (a.prenom || '') + ' ' + (a.nom || '') + ' - ' + (a.grade || 'CID');
          return '<option value="' + esc(label.trim()) + '">' + esc(label.trim()) + '</option>';
        }).join('')
      : '<option value="">Aucun agent CID trouve - saisie manuelle</option>';
    openModal({
      eyebrow: 'CID - Personne liee',
      title: 'Ajouter une personne',
      size: 'lg',
      body: `
        <div class="cid-page">${cidCss2()}
          <section class="cid-card">
            <form id="cidPersonForm" onsubmit="event.preventDefault();cidSavePersonModal('${id}')">
              <div class="cid-grid">
                <input name="nom" id="cidPersonName" placeholder="Nom / prenom" required>
                <select name="type" id="cidPersonType" onchange="cidToggleInvestigatorPicker()">${cidOptions(['Citoyen','Suspect','Victime','Temoin','Informateur','Agent infiltre','Enqueteur'], 'Suspect')}</select>
                <input name="tel" placeholder="Numero de telephone">
                <select id="cidInvestigatorSelect" style="display:none" onchange="cidPickInvestigator(this.value)">${investigatorOptions}</select>
              </div>
              <textarea name="commentaires" rows="4" placeholder="Commentaires CID" style="margin-top:10px"></textarea>
            </form>
          </section>
        </div>`,
      footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidSavePersonModal(\'' + id + '\')">Ajouter</button>'
    });
  });
}

function cidSavePersonModal(id){
  var c = cidGet(id), f = document.getElementById('cidPersonForm');
  if (!c || !f) return;
  var fd = new FormData(f);
  var nom = fd.get('nom');
  if (!nom) return toast('Nom requis.');
  c.personnes = c.personnes || [];
  var person = {id:'p_' + Date.now(), nom:nom, type:fd.get('type') || 'Citoyen', tel:fd.get('tel') || '', commentaires:fd.get('commentaires') || '', fichiers:[]};
  c.personnes.push(person);
  c.suspects = c.personnes.filter(function(p){ return /suspect/i.test(p.type); }).length;
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: 'Personne ajoutee : ' + nom});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id:id, person:person.id});
}

function cidPersonWorkspace(c, pid){
  var p = c && (c.personnes || []).find(function(x){ return x.id === pid; });
  if (!c || !p) return cidCaseWorkspace(c);
  var files = p.fichiers || [];
  return `
    <section class="cid-workspace">
      <button class="cid-return" onclick="navigate('cid',{id:'${c.id}'})">Retour au dossier</button>
      <div class="cid-case-head">
        <div><div class="cid-case-id">${esc(c.numero || 'CID')} - Fiche personne</div><h1 class="cid-case-title">${esc(p.nom || 'Personne')}</h1><div class="cid-subline"><span>${esc(p.type || '-')}</span><span>${esc(p.tel || '-')}</span></div></div>
        <div class="cid-actions"><button class="cid-gold-btn" onclick="cidOpenPersonFile('${c.id}','${p.id}')">Ajouter fichier</button><button class="cid-red-btn" onclick="cidDeletePerson('${c.id}','${p.id}')">Supprimer</button></div>
      </div>
      <div class="cid-detail-grid" style="grid-template-columns:1fr 1fr">
        <section class="cid-panel">
          <h3>Identite</h3>
          <form id="cidPersonProfileForm" onsubmit="event.preventDefault();cidSavePersonProfile('${c.id}','${p.id}')">
            <div class="cid-info-grid">
              <input name="nom" value="${esc(p.nom || '')}" placeholder="Nom / prenom">
              <select name="type">${cidOptions(['Citoyen','Suspect','Victime','Temoin','Informateur','Agent infiltre','Enqueteur'], p.type || 'Citoyen')}</select>
              <input name="tel" value="${esc(p.tel || '')}" placeholder="Telephone">
            </div>
            <textarea name="commentaires" rows="7" style="margin-top:10px" placeholder="Notes, habitudes, signalement, liens...">${esc(p.commentaires || '')}</textarea>
            <button class="cid-blue-btn" style="margin-top:10px">Sauvegarder</button>
          </form>
        </section>
        <section class="cid-panel">
          <h3>Photos / fichiers</h3>
          <div class="cid-mini-list">${files.length ? files.map(function(f){
            var click = "cidPersonFilePreview(" + JSON.stringify(c.id) + "," + JSON.stringify(p.id) + "," + JSON.stringify(f.id) + ")";
            return '<div class="cid-mini" style="display:flex;gap:10px;align-items:center">' + cidAttachmentHtml(f.attachment, f.type, click) + '<div><strong>'+esc(f.type || 'Fichier')+'</strong><br><small>'+esc(f.date || '-')+'</small><br>'+esc(f.note || '')+'</div></div>';
          }).join('') : '<div class="cid-mini">Aucun fichier sur cette fiche.</div>'}</div>
        </section>
      </div>
    </section>`;
}

function cidSavePersonProfile(id, pid){
  var c = cidGet(id), f = document.getElementById('cidPersonProfileForm');
  var p = c && (c.personnes || []).find(function(x){ return x.id === pid; });
  if (!c || !p || !f) return;
  var fd = new FormData(f);
  p.nom = fd.get('nom') || p.nom;
  p.type = fd.get('type') || p.type;
  p.tel = fd.get('tel') || '';
  p.commentaires = fd.get('commentaires') || '';
  c.suspects = (c.personnes || []).filter(function(x){ return /suspect/i.test(x.type); }).length;
  cidUpsert(c);
  toast('Fiche personne sauvegardee.');
  navigate('cid', {id:id, person:pid});
}

function cidProofDetailsText(c, e){
  var d = e.details || {};
  if (e.type === 'Arme') return [d.type_arme, d.numero_serie ? 'Serie ' + d.numero_serie : '', cidPersonNameById(c, d.suspect_id)].filter(Boolean).join(' - ');
  if (e.type === 'Drogue') return [d.type_drogue, d.quantite, cidPersonNameById(c, d.suspect_id)].filter(Boolean).join(' - ');
  if (e.type === 'Vehicule') return [d.modele, d.plaque ? 'Plaque ' + d.plaque : '', cidPersonNameById(c, d.suspect_id)].filter(Boolean).join(' - ');
  return e.description || '';
}

function cidPersonNameById(c, pid){
  var p = c && (c.personnes || []).find(function(x){ return x.id === pid; });
  return p ? p.nom : '';
}

function cidCaseWorkspace(c){
  if (!c) return '<section class="cid-workspace cid-empty-panel"><div><div class="cid-brand-icon" style="margin:0 auto 12px">CID</div><h2>Aucun dossier selectionne</h2><p>Creer ou selectionner un dossier pour ouvrir le poste de travail.</p></div></section>';
  var proofs = c.preuves || [];
  var people = c.personnes || [];
  return `
    <section class="cid-workspace">
      <button class="cid-return" onclick="navigate('cid')">Retour aux dossiers</button>
      <div class="cid-case-head">
        <div><div class="cid-case-id">${esc(c.numero || 'CID')}</div><h1 class="cid-case-title">${esc(c.titre || 'Dossier sans titre')}</h1><div class="cid-subline"><span>Ouvert le ${esc(c.date_ouverture || '-')}</span><span>Derniere modif. ${esc(c.updated_at || '-')}</span><span>Par ${esc(c.responsable || 'CID')}</span></div></div>
        <div class="cid-actions"><button class="cid-soft-btn" onclick="cidOpenEditCase('${c.id}')">Modifier</button><button class="cid-soft-btn" onclick="cidAddLog('${c.id}')">Note</button><button class="cid-blue-btn" onclick="cidAddPerson('${c.id}')">Personne</button><button class="cid-gold-btn" onclick="cidAddProof('${c.id}')">Preuve</button><button class="cid-soft-btn" onclick="cidArchive('${c.id}')">Archiver</button><button class="cid-red-btn" onclick="cidDelete('${c.id}')">Supprimer</button></div>
      </div>
      <div class="cid-summary-chips">
        <div class="cid-chip"><span>Statut</span><strong><span class="cid-badge2 ${cidStatusTone(c.statut)}">${esc(c.statut || '-')}</span></strong></div>
        <div class="cid-chip"><span>Priorite</span><strong><span class="cid-badge2 ${cidPriorityTone(c.priorite)}">${esc(c.priorite || '-')}</span></strong></div>
        <div class="cid-chip"><span>Classification</span><strong>${esc(c.classification || '-')}</strong></div>
        <div class="cid-chip"><span>Confidentialite</span><strong>${esc(c.confidentialite || '-')}</strong></div>
      </div>
      <div class="cid-detail-grid" style="grid-template-columns:1fr 1fr">
        <div class="cid-panel"><h3>Personnes</h3><table class="cid-mini-table"><tbody>${people.length ? people.map(function(p){return "<tr style=\"cursor:pointer\" onclick='navigate(\"cid\",{id:" + JSON.stringify(c.id) + ",person:" + JSON.stringify(p.id) + "})'><td><strong>"+esc(p.nom)+"</strong></td><td><span class=\"cid-badge2 blue\">"+esc(p.type)+"</span></td><td>"+esc(p.tel || "-")+"</td></tr>";}).join('') : '<tr><td>Aucune personne.</td></tr>'}</tbody></table></div>
        <div class="cid-panel"><h3>Preuves</h3><table class="cid-mini-table"><thead><tr><th>Apercu</th><th>Scelle</th><th>Type</th><th>Infos</th></tr></thead><tbody>${proofs.length ? proofs.map(function(e){var click="cidEvidencePreview("+JSON.stringify(c.id)+","+JSON.stringify(e.id)+")";return '<tr><td>'+cidAttachmentHtml(e.attachment, e.type, click)+'</td><td>'+esc(e.scelle || '-')+'</td><td><span class="cid-badge2 gold">'+esc(e.type || '-')+'</span></td><td>'+esc(cidProofDetailsText(c,e) || '-')+'</td></tr>';}).join('') : '<tr><td colspan="4">Aucune preuve.</td></tr>'}</tbody></table></div>
      </div>
      <section class="cid-panel" style="margin-top:12px"><h3>Resume</h3><p class="cid-text">${esc(c.resume || c.description || 'Aucun resume renseigne.')}</p></section>
    </section>`;
}

async function renderCID3(){
  if (!canAccessCID()) {
    setContent('<div class="empty-state"><div class="empty-icon">CID</div><div class="empty-title">Acces restreint</div><div class="empty-sub">Role CID requis.</div></div>');
    return;
  }
  var list = cidLoad();
  var q = (S.pd && S.pd.q) || '';
  var filter = (S.pd && S.pd.filter) || 'Toutes';
  var visible = list.filter(function(c){
    var ok = filter === 'Toutes' || c.statut === filter;
    var peopleHay = (c.personnes || []).map(function(p){ return [p.nom,p.type,p.tel].join(' '); }).join(' ');
    var proofsHay = (c.preuves || []).map(function(p){ return [p.scelle,p.type,p.description,cidProofDetailsText(c,p)].join(' '); }).join(' ');
    var hay = [c.numero, c.titre, c.statut, c.priorite, c.classification, c.responsable, c.resume, peopleHay, proofsHay].join(' ').toLowerCase();
    return ok && hay.indexOf(q.toLowerCase()) !== -1;
  }).sort(function(a,b){ return String(b.updated_at || '').localeCompare(String(a.updated_at || '')); });
  var activeId = (S.pd && S.pd.id) || (visible[0] && visible[0].id);
  var active = activeId ? cidGet(activeId) : null;
  var openCount = list.filter(function(c){ return c.statut === 'Ouvert'; }).length;
  var waitCount = list.filter(function(c){ return c.statut === 'En attente'; }).length;
  var closedCount = list.filter(function(c){ return /ferme|classe/i.test(c.statut || ''); }).length;
  setContent(`
    <div class="cid-mdt">
      ${cidCss2()}
      <section class="cid-topbar">
        <div class="cid-brand"><div class="cid-brand-icon">CID</div><div><div class="cid-brand-title">CID</div><div class="cid-brand-sub">Criminal Investigation Division</div></div></div>
        <div class="cid-global-search"><input id="cidSearchInput" placeholder="Rechercher un dossier, une personne, une preuve..." value="${esc(q)}"><span class="cid-key">CTRL K</span></div>
        <div class="cid-session"><span class="cid-pill">Connecte Discord <i class="cid-dot"></i></span><span class="cid-pill">Acces CID <b class="cid-dot"></b></span></div>
      </section>
      <div class="cid-shell">
        <aside class="cid-list-pane">
          <div class="cid-pane-head"><div class="cid-pane-title">Dossiers</div><button class="cid-blue-btn" onclick="cidOpenCreate()">Nouveau</button></div>
          <div class="cid-filter-zone">
            <input id="cidSideSearch" placeholder="Rechercher..." value="${esc(q)}">
            <select id="cidFilterSelect"><option>Toutes</option>${cidOptions(CID_STATUTS, filter)}</select>
            <div class="cid-tabs"><button class="cid-tab ${filter==='Toutes'?'active':''}" onclick="navigate('cid',{filter:'Toutes',q:'${esc(q)}'})">Tous ${list.length}</button><button class="cid-tab" onclick="navigate('cid',{filter:'Ouvert',q:'${esc(q)}'})">Ouverts ${openCount}</button><button class="cid-tab" onclick="navigate('cid',{filter:'En attente',q:'${esc(q)}'})">Attente ${waitCount}</button><button class="cid-tab" onclick="navigate('cid',{filter:'Classe',q:'${esc(q)}'})">Archives ${closedCount}</button></div>
          </div>
          <div class="cid-case-list">${visible.length ? visible.map(function(c){return "<article class=\"cid-case-card " + (active && active.id === c.id ? "active" : "") + "\" onclick='navigate(\"cid\",{id:" + JSON.stringify(c.id) + "})'><div class=\"cid-card-top\"><span>" + esc(c.numero || "CID") + "</span><span class=\"cid-badge2 " + cidPriorityTone(c.priorite) + "\">" + esc(c.priorite || "Normale") + "</span></div><div class=\"cid-case-name\">" + esc(c.titre || "Dossier sans titre") + "</div><div class=\"cid-case-meta\"><span>" + esc(c.responsable || "CID") + "</span><span>" + esc(c.updated_at || "-") + "</span></div></article>";}).join('') : '<div class="cid-empty-panel" style="min-height:220px">Aucun dossier.</div>'}</div>
          <div class="cid-footer-pages">1-${visible.length} sur ${list.length} dossiers</div>
        </aside>
        ${(S.pd && S.pd.person) ? cidPersonWorkspace(active, S.pd.person) : cidCaseWorkspace(active)}
      </div>
    </div>`);
  var search = document.getElementById('cidSearchInput');
  var sideSearch = document.getElementById('cidSideSearch');
  var select = document.getElementById('cidFilterSelect');
  function goSearch(value){ navigate('cid', {q: value, filter: select ? select.value : filter}); }
  if (search) search.addEventListener('change', function(){ goSearch(this.value); });
  if (sideSearch) sideSearch.addEventListener('change', function(){ goSearch(this.value); });
  if (select) select.addEventListener('change', function(){ navigate('cid', {filter: this.value, q: sideSearch ? sideSearch.value : q}); });
}

function cidPreviewAttachment(file){
  if (!file || !file.data) return toast('Aucun fichier a afficher.');
  var body = '<div style="text-align:center">';
  if (String(file.type || '').indexOf('image/') === 0) {
    body += '<img src="' + file.data + '" style="max-width:100%;max-height:72vh;border-radius:8px;border:1px solid rgba(80,122,170,.35)">';
  } else if (String(file.type || '').indexOf('video/') === 0) {
    body += '<video controls src="' + file.data + '" style="max-width:100%;max-height:72vh;border-radius:8px"></video>';
  } else if (String(file.type || '').indexOf('audio/') === 0) {
    body += '<audio controls src="' + file.data + '" style="width:100%"></audio>';
  } else {
    body += '<a class="cid-blue-btn" download="' + esc(file.name || 'preuve') + '" href="' + file.data + '">Telecharger le fichier</a>';
  }
  body += '</div>';
  openModal({eyebrow:'CID - Piece jointe', title:file.name || 'Apercu', size:'xl', body:body, footer:'<button class="cid-soft-btn" onclick="closeModal()">Fermer</button>'});
}

function cidAttachmentHtml(file, label, onclick){
  if (!file || !file.data) return '<span>-</span>';
  var name = esc(label || file.name || 'Fichier');
  if (String(file.type || '').indexOf('image/') === 0) {
    return '<button type="button" onclick="' + onclick + '" style="border:0;background:transparent;padding:0;cursor:pointer"><img src="' + file.data + '" alt="' + name + '" class="cid-preview-img"></button>';
  }
  return '<button type="button" class="cid-soft-btn" onclick="' + onclick + '">' + name + '</button>';
}

function cidIsUserNote(j){
  var text = String((j && j.texte) || '');
  if (j && j.type === 'note') return true;
  return !/^(Preuve ajoutee|Personne ajoutee|Fichier ajoute|Fiche personne modifiee|Dossier cree)/i.test(text);
}

function cidAddLog(id){
  openModal({
    eyebrow: 'CID - Note',
    title: 'Ajouter une note',
    size: 'lg',
    body: `
      <div class="cid-page">${cidCss2()}
        <section class="cid-card">
          <form id="cidLogForm" onsubmit="event.preventDefault();cidSaveLogModal('${id}')">
            <textarea name="texte" rows="5" placeholder="Note, action, observation..." required></textarea>
          </form>
        </section>
      </div>`,
    footer: '<button class="cid-soft-btn" onclick="closeModal()">Annuler</button><button class="cid-gold-btn" onclick="cidSaveLogModal(\'' + id + '\')">Ajouter</button>'
  });
}

function cidSaveLogModal(id){
  var c = cidGet(id), f = document.getElementById('cidLogForm');
  if (!c || !f) return;
  var texte = new FormData(f).get('texte');
  if (!texte) return toast('Note requise.');
  c.journal = c.journal || [];
  c.journal.unshift({date: cidNow(), texte: texte, type: 'note'});
  cidUpsert(c);
  closeModal();
  navigate('cid', {id:id});
}

function cidCaseWorkspace(c){
  if (!c) return '<section class="cid-workspace cid-empty-panel"><div><div class="cid-brand-icon" style="margin:0 auto 12px">CID</div><h2>Aucun dossier selectionne</h2><p>Creer ou selectionner un dossier pour ouvrir le poste de travail.</p></div></section>';
  var proofs = c.preuves || [];
  var people = c.personnes || [];
  var notes = (c.journal || []).filter(cidIsUserNote);
  return `
    <section class="cid-workspace">
      <button class="cid-return" onclick="navigate('cid')">Retour aux dossiers</button>
      <div class="cid-case-head">
        <div>
          <div class="cid-case-id">${esc(c.numero || 'CID')}</div>
          <h1 class="cid-case-title">${esc(c.titre || 'Dossier sans titre')}</h1>
          <div class="cid-subline"><span>Ouvert le ${esc(c.date_ouverture || '-')}</span><span>Derniere modif. ${esc(c.updated_at || '-')}</span><span>Par ${esc(c.responsable || 'CID')}</span></div>
        </div>
        <div class="cid-actions">
          <button class="cid-soft-btn" onclick="cidOpenEditCase('${c.id}')">Modifier</button>
          <button class="cid-soft-btn" onclick="cidAddLog('${c.id}')">Note</button>
          <button class="cid-blue-btn" onclick="cidAddPerson('${c.id}')">Personne</button>
          <button class="cid-gold-btn" onclick="cidAddProof('${c.id}')">Preuve</button>
          <button class="cid-soft-btn" onclick="cidArchive('${c.id}')">Archiver</button>
          <button class="cid-red-btn" onclick="cidDelete('${c.id}')">Supprimer</button>
        </div>
      </div>
      <div class="cid-summary-chips">
        <div class="cid-chip"><span>Statut</span><strong><span class="cid-badge2 ${cidStatusTone(c.statut)}">${esc(c.statut || '-')}</span></strong></div>
        <div class="cid-chip"><span>Priorite</span><strong><span class="cid-badge2 ${cidPriorityTone(c.priorite)}">${esc(c.priorite || '-')}</span></strong></div>
        <div class="cid-chip"><span>Classification</span><strong>${esc(c.classification || '-')}</strong></div>
        <div class="cid-chip"><span>Confidentialite</span><strong>${esc(c.confidentialite || '-')}</strong></div>
      </div>
      <div class="cid-detail-grid" style="grid-template-columns:1fr 1fr">
        <div class="cid-panel">
          <h3>Personnes</h3>
          <table class="cid-mini-table"><tbody>${people.length ? people.map(function(p){return "<tr style=\"cursor:pointer\" onclick='navigate(\"cid\",{id:" + JSON.stringify(c.id) + ",person:" + JSON.stringify(p.id) + "})'><td><strong>"+esc(p.nom)+"</strong></td><td><span class=\"cid-badge2 blue\">"+esc(p.type || "-")+"</span></td><td>"+esc(p.tel || "-")+"</td></tr>";}).join('') : '<tr><td>Aucune personne.</td></tr>'}</tbody></table>
        </div>
        <div class="cid-panel">
          <h3>Preuves</h3>
          <table class="cid-mini-table"><thead><tr><th>Apercu</th><th>Scelle</th><th>Type</th><th>Infos</th></tr></thead><tbody>${proofs.length ? proofs.map(function(e){var click="cidEvidencePreview("+JSON.stringify(c.id)+","+JSON.stringify(e.id)+")";return '<tr><td>'+cidAttachmentHtml(e.attachment, e.type, click)+'</td><td>'+esc(e.scelle || '-')+'</td><td><span class="cid-badge2 gold">'+esc(e.type || '-')+'</span></td><td>'+esc(cidProofDetailsText(c,e) || '-')+'</td></tr>';}).join('') : '<tr><td colspan="4">Aucune preuve.</td></tr>'}</tbody></table>
        </div>
      </div>
      <div class="cid-detail-grid" style="grid-template-columns:1fr 1fr">
        <section class="cid-panel">
          <h3>Resume / description</h3>
          <p class="cid-text">${esc(c.resume || c.description || 'Aucun resume renseigne.')}</p>
        </section>
        <section class="cid-panel">
          <h3>Notes</h3>
          <div class="cid-mini-list">${notes.length ? notes.map(function(j){return '<div class="cid-mini"><strong>'+esc(j.date || '-')+'</strong><br>'+esc(j.texte || '')+'</div>';}).join('') : '<div class="cid-mini">Aucune note.</div>'}</div>
        </section>
      </div>
    </section>`;
}

function renderCartes() {
  setContent(
    '<div style="display:flex;flex-direction:column;height:calc(100vh - 60px);margin:-24px">' +
      '<iframe src="carte.html?v=4" style="flex:1;border:none;width:100%;height:100%;" allowfullscreen></iframe>' +
    '</div>'
  );
}

// ══ HISTORIQUE POINTAGES ══════════════════════════════════════════
var _pointeusePaiements = {};
var _pointeusePaiementsMissing = false;
var _pointeuseCorrections = {};
var _pointeuseCorrectionsMissing = false;

function pointeusePaiementKey(semaineKey, agentId) {
  return String(semaineKey || '') + '::' + String(agentId || '');
}

function pointeuseCorrectionKey(semaineKey, agentId) {
  return String(semaineKey || '') + '::' + String(agentId || '');
}

function isMissingPointeusePaiementsTable(err) {
  var msg = String((err && (err.message || err.details || err.hint)) || err || '');
  return /pointeuse_paiements|schema cache|does not exist|not find the table|relation .* does not exist/i.test(msg);
}

function isMissingPointeuseCorrectionsTable(err) {
  var msg = String((err && (err.message || err.details || err.hint)) || err || '');
  return /pointeuse_corrections|schema cache|does not exist|not find the table|relation .* does not exist/i.test(msg);
}

function currentPointeusePaidActor() {
  if (S.appUser && (S.appUser.prenom || S.appUser.nom)) return ((S.appUser.prenom || '') + ' ' + (S.appUser.nom || '')).trim();
  if (S.serverNick) return S.serverNick;
  if (S.user && S.user.user_metadata) {
    return S.user.user_metadata.full_name || S.user.user_metadata.name || S.user.user_metadata.user_name || 'Utilisateur SASP';
  }
  return 'Utilisateur SASP';
}

function parseHoursInput(v) {
  var n = parseFloat(String(v || '').replace(',', '.'));
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

function fmtMinutesDuration(minutes) {
  minutes = Math.max(0, parseInt(minutes || 0, 10));
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  return h + 'h' + (m < 10 ? '0' : '') + m;
}

function pointeuseAgentKey(a) {
  a = a || {};
  return a.id || a.matricule || ((a.prenom || '') + (a.nom || ''));
}

function getPointeuseCorrectionMinutes(semaineKey, agentId) {
  var row = _pointeuseCorrections[pointeuseCorrectionKey(semaineKey, agentId)];
  if (row) return parseInt(row.minutes_retires || 0, 10) || 0;
  if (_pointeuseCorrectionsMissing) {
    return parseInt(localStorage.getItem('corr_' + semaineKey + '_' + agentId) || '0', 10) || 0;
  }
  return 0;
}

function copyPointeuseCorrectionsSql() {
  var sql = [
    'create extension if not exists pgcrypto;',
    '',
    'create table if not exists public.pointeuse_corrections (',
    '  id uuid primary key default gen_random_uuid(),',
    '  semaine_key text not null,',
    '  semaine_label text,',
    '  agent_id text not null,',
    '  agent_matricule text,',
    '  agent_nom text,',
    '  minutes_retires integer not null default 0,',
    '  updated_by text,',
    '  created_at timestamptz not null default now(),',
    '  updated_at timestamptz not null default now(),',
    '  constraint pointeuse_corrections_unique unique (semaine_key, agent_id)',
    ');',
    '',
    'alter table public.pointeuse_corrections enable row level security;',
    '',
    'drop policy if exists pointeuse_corrections_auth_all on public.pointeuse_corrections;',
    'create policy pointeuse_corrections_auth_all',
    'on public.pointeuse_corrections',
    'for all',
    'to authenticated',
    'using (true)',
    'with check (true);',
    '',
    'drop policy if exists pointeuse_corrections_anon_all on public.pointeuse_corrections;',
    'create policy pointeuse_corrections_anon_all',
    'on public.pointeuse_corrections',
    'for all',
    'to anon',
    'using (true)',
    'with check (true);',
    '',
    "notify pgrst, 'reload schema';"
  ].join('\n');
  fallbackCopyText(sql, function() { toast('SQL corrections copie.', 'success'); });
}

function correctedPointeuseSeconds(semaineKey, agentId, seconds) {
  return Math.max(0, Math.floor(seconds || 0) - (getPointeuseCorrectionMinutes(semaineKey, agentId) * 60));
}

async function renderPointeuseHistorique() {
  if (!canWrite()) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div></div>');
    return;
  }
  var [all, actives, rosterAgents] = await Promise.all([DB.getAllPointages(), DB.getActivePointages(), DB.getAgents({})]);
  _pointeusePaiements = {};
  _pointeusePaiementsMissing = false;
  try {
    (await DB.getPointeusePaiements()).forEach(function(p) {
      _pointeusePaiements[pointeusePaiementKey(p.semaine_key, p.agent_id)] = p;
    });
  } catch(e) {
    _pointeusePaiementsMissing = isMissingPointeusePaiementsTable(e);
    if (!_pointeusePaiementsMissing) throw e;
  }
  _pointeuseCorrections = {};
  _pointeuseCorrectionsMissing = false;
  try {
    (await DB.getPointeuseCorrections()).forEach(function(p) {
      _pointeuseCorrections[pointeuseCorrectionKey(p.semaine_key, p.agent_id)] = p;
    });
  } catch(e) {
    _pointeuseCorrectionsMissing = isMissingPointeuseCorrectionsTable(e);
    if (!_pointeuseCorrectionsMissing) throw e;
  }
  var activeAgentIds = new Set(actives.map(function(p){ return p.agent_id; }));
  rosterAgents = visibleRosterAgents(rosterAgents || []).sort(function(a, b) {
    return parseInt(a.matricule || 999) - parseInt(b.matricule || 999);
  });

  // Grouper par semaine (lundi de la semaine)
  var byWeek = {};
  all.forEach(function(p) {
    var d = new Date(p.clock_in);
    var dow = d.getDay();
    var monday = new Date(d);
    monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    monday.setHours(0, 0, 0, 0);
    var key = monday.toISOString().slice(0, 10);
    if (!byWeek[key]) byWeek[key] = { monday: monday, entries: [] };
    byWeek[key].entries.push(p);
  });

  var weekKeys = Object.keys(byWeek).sort(function(a, b) { return b.localeCompare(a); });

  if (!weekKeys.length) {
    setContent(
      '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Historique pointages</h1></div>' +
      '<button class="btn btn-ghost btn-sm" onclick="navigate(\'pointeuse\')">← Retour</button></div>' +
      '<div class="card"><p class="text-muted" style="padding:12px">Aucun pointage enregistré.</p></div>'
    );
    return;
  }

  var accordionHtml = weekKeys.map(function(key, idx) {
    var week = byWeek[key];
    var sun = new Date(week.monday.getTime() + 6 * 86400000);
    var label = 'Semaine du ' +
      week.monday.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' }) +
      ' au ' + sun.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric' });

    // Regrouper les pointages par agent
    var byAgent = {};
    week.entries.forEach(function(p) {
      var a = p.agents || {};
      var agId = a.id || (a.prenom + '_' + a.nom);
      if (!byAgent[agId]) byAgent[agId] = { agent: a, sec: 0, ongoing: false, sessions: [] };
      byAgent[agId].sessions.push(p);
      if (p.clock_out) {
        byAgent[agId].sec += Math.floor((new Date(p.clock_out) - new Date(p.clock_in)) / 1000);
      } else {
        byAgent[agId].ongoing = true;
      }
    });

    var totalSec = 0;
    var totalSalaire = 0;
    var totalPrimes = 0;
    var agentList = Object.values(byAgent).sort(function(x, y) {
      return parseInt(x.agent.matricule || 999) - parseInt(y.agent.matricule || 999);
    });
    var weekAgentIds = new Set(agentList.map(function(e) {
      var a = e.agent || {};
      return a.id || a.matricule || ((a.prenom || '') + '_' + (a.nom || ''));
    }));
    var missingAgents = rosterAgents.filter(function(a) {
      var keyAgent = a.id || a.matricule || ((a.prenom || '') + '_' + (a.nom || ''));
      return !weekAgentIds.has(keyAgent);
    });
    var missingHtml = missingAgents.length
      ? missingAgents.map(function(a) {
          return '<span class="badge badge-gray" style="font-size:.68rem;margin:3px 4px 3px 0">' + esc(a.matricule || '--') + ' · ' + esc((a.prenom || '') + ' ' + (a.nom || '')) + '</span>';
        }).join('')
      : '<span class="badge badge-green" style="font-size:.68rem">Tout le monde a pointe</span>';
    agentList.forEach(function(e) {
      var a = e.agent || {};
      var agentKey = pointeuseAgentKey(a);
      var correctedSec = correctedPointeuseSeconds(key, agentKey, e.sec);
      var primeKey = 'prime_' + key + '_' + agentKey;
      var prime = parseMoneyInput(localStorage.getItem(primeKey));
      totalSec += correctedSec;
      totalPrimes += prime;
      totalSalaire += calcSalaire(a.grade, correctedSec) + prime;
    });
    var topAgents = agentList.map(function(e) {
      var a = e.agent || {};
      var agentKey = pointeuseAgentKey(a);
      return { agent: a, sec: correctedPointeuseSeconds(key, agentKey, e.sec) };
    }).filter(function(e){ return e.sec > 0; }).sort(function(a, b){ return b.sec - a.sec; }).slice(0, 3);
    var topHtml = topAgents.length
      ? topAgents.map(function(e, i) {
          var a = e.agent || {};
          return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 10px;border:1px solid var(--border0);border-radius:var(--rSm);background:rgba(12,20,34,.62)">' +
            '<span><strong class="text-gold">#' + (i + 1) + '</strong> ' + esc((a.prenom || '') + ' ' + (a.nom || '')) + ' <span class="text-muted">(' + esc(a.matricule || '--') + ')</span></span>' +
            '<strong>' + fmtSec(e.sec) + '</strong>' +
          '</div>';
        }).join('')
      : '<span class="badge badge-gray" style="font-size:.68rem">Aucun service termine</span>';

    var rows = agentList.map(function(entry) {
      var a = entry.agent;
      var rawSec = entry.sec;
      var agentKey = pointeuseAgentKey(a);
      var correctionMinutes = getPointeuseCorrectionMinutes(key, agentKey);
      var correctionHours = correctionMinutes ? String(Math.round((correctionMinutes / 60) * 100) / 100) : '';
      var sec = correctedPointeuseSeconds(key, agentKey, rawSec);
      var sal = calcSalaire(a.grade, sec);
      var primeKey = 'prime_' + key + '_' + agentKey;
      var prime = parseMoneyInput(localStorage.getItem(primeKey));
      var totalAgent = sal + prime;
      var paidAgentId = agentKey;
      var paidKey = pointeusePaiementKey(key, paidAgentId);
      var paidRow = _pointeusePaiements[paidKey];
      var legacyPaidKey = 'paid_' + key + '_' + (a.id || a.matricule || (a.prenom + a.nom));
      var isPaid = paidRow ? !!paidRow.paye : (_pointeusePaiementsMissing && localStorage.getItem(legacyPaidKey) === '1');
      var paidTitle = paidRow && paidRow.checked_by
        ? ' title="Derniere modification: ' + esc(paidRow.checked_by) + (paidRow.checked_at ? ' - ' + fmtClock(paidRow.checked_at) : '') + '"'
        : '';
      var enService = a.id && activeAgentIds.has(a.id);
      var dot = '<span title="' + (enService ? 'En service' : 'Hors service') + '" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (enService ? '#2ecc71' : '#e74c3c') + ';box-shadow:0 0 ' + (enService ? '6px #2ecc71' : '0px') + '"></span>';
      var sessionsHtml = (entry.sessions || []).slice(0, 4).map(function(p) {
        return '<div style="white-space:nowrap;font-family:monospace;font-size:.75rem;color:var(--t2)">' +
          fmtClock(p.clock_in) + ' → ' + (p.clock_out ? fmtClock(p.clock_out) : '<span style="color:var(--gold)">en cours</span>') +
        '</div>';
      }).join('');
      var iban = a.iban || '';
      var ibanCell = iban
        ? '<div style="display:flex;align-items:center;gap:6px;white-space:nowrap"><code style="font-family:monospace;font-size:.8rem;color:var(--t2)">' + esc(iban) + '</code><button class="btn btn-ghost btn-sm" title="Copier l IBAN" onclick="event.stopPropagation();copyIban(\'' + esc(String(iban).replace(/\\/g, '\\\\').replace(/'/g, "\\'")) + '\')">Copier</button></div>'
        : '<span style="font-family:monospace;font-size:.8rem;color:var(--t3)">—</span>';
      var telephone = fmtTel(a.telephone) || '';
      var telephoneCell = telephone
        ? '<div style="display:flex;align-items:center;gap:6px;white-space:nowrap"><code style="font-family:monospace;font-size:.8rem;color:var(--t2)">' + esc(telephone) + '</code><button class="btn btn-ghost btn-sm" title="Copier le telephone" onclick="event.stopPropagation();copyTelephone(\'' + jsStr(telephone) + '\')">Copier</button></div>'
        : '<span style="font-family:monospace;font-size:.8rem;color:var(--t3)">-</span>';
      return '<tr style="' + (isPaid ? 'opacity:.5' : '') + '">' +
        '<td style="white-space:nowrap">' + dot + ' <strong>' + esc((a.prenom || '') + ' ' + (a.nom || '')) + '</strong><br><small style="color:var(--t3)">' + esc(a.matricule || '') + '</small></td>' +
        '<td>' + ibanCell + '</td>' +
        '<td>' + telephoneCell + '</td>' +
        '<td>' + (sessionsHtml || '<span style="color:var(--t3)">—</span>') + '</td>' +
        '<td style="text-align:center"><strong>' + fmtSec(sec) + '</strong>' + (entry.ongoing ? ' <span style="color:var(--gold);font-size:.75rem">+en cours</span>' : '') + (correctionMinutes ? '<br><small style="color:' + (correctionMinutes > 0 ? 'var(--red,#ff5b5b)' : 'var(--green,#2ecc71)') + '">brut ' + fmtSec(rawSec) + (correctionMinutes > 0 ? ' - retrait ' + fmtMinutesDuration(correctionMinutes) : ' + crédit ' + fmtMinutesDuration(Math.abs(correctionMinutes))) + '</small>' : '') + '</td>' +
        '<td style="text-align:center;color:var(--gold);font-weight:700">' + fmtMoney(sal) + '</td>' +
        '<td style="text-align:center"><div style="display:flex;align-items:center;justify-content:center;gap:5px"><input type="number" step="0.25" value="' + esc(correctionHours) + '" onchange="setCorrectionHisto(\'' + jsStr(key) + '\',\'' + jsStr(agentKey) + '\',\'' + jsStr(label) + '\',\'' + jsStr(a.matricule || '') + '\',\'' + jsStr(((a.prenom || '') + ' ' + (a.nom || '')).trim()) + '\',this.value,this)" title="Heures a retirer du calcul. Valeur négative = heures créditées." style="width:74px;background:var(--bg2);color:var(--t0);border:1px solid var(--border0);border-radius:6px;padding:5px 7px;text-align:right"><span style="font-size:.75rem;color:var(--t3)">h</span></div></td>' +
        '<td style="text-align:center"><input type="number" min="0" step="1" value="' + prime + '" onchange="setPrimeHisto(\'' + primeKey + '\',this.value)" style="width:92px;background:var(--bg2);color:var(--t0);border:1px solid var(--border0);border-radius:6px;padding:5px 7px;text-align:right"></td>' +
        '<td style="text-align:center;color:var(--green,#2ecc71);font-weight:700">' + fmtMoney(totalAgent) + '</td>' +
        '<td style="text-align:center"><input type="checkbox"' + (isPaid ? ' checked' : '') + paidTitle + ' onchange="togglePaidHisto(\'' + jsStr(key) + '\',\'' + jsStr(paidAgentId) + '\',\'' + jsStr(label) + '\',\'' + jsStr(a.matricule || '') + '\',\'' + jsStr(((a.prenom || '') + ' ' + (a.nom || '')).trim()) + '\',this)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--green,#2ecc71)"></td>' +
      '</tr>';
    }).join('');

    var panelId = 'wk_' + key.replace(/-/g, '');
    var panelOpen = sessionStorage.getItem('histo_open_' + panelId) === '1';
    return '<div style="border:1px solid var(--border1);border-radius:var(--rSm);margin-bottom:8px;overflow:hidden">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;background:var(--bg1)" onclick="toggleWeek(\'' + panelId + '\')">' +
        '<div>' +
          '<span style="font-weight:600;color:var(--t0)">' + label + '</span>' +
          '<span style="margin-left:12px;font-size:.8rem;color:var(--t3)">' + agentList.length + ' agent' + (agentList.length > 1 ? 's' : '') + ' · ' + fmtSec(totalSec) + ' total</span>' +
          (totalPrimes ? '<span style="margin-left:10px;font-size:.8rem;color:var(--blue);font-weight:700">Primes ' + fmtMoney(totalPrimes) + '</span>' : '') +
          '<span style="margin-left:10px;font-size:.8rem;color:var(--gold);font-weight:700">' + fmtMoney(totalSalaire) + '</span>' +
        '</div>' +
        '<span id="' + panelId + '_ico">' + (panelOpen ? '▲' : '▼') + '</span>' +
      '</div>' +
      '<div id="' + panelId + '" style="display:' + (panelOpen ? 'block' : 'none') + '">' +
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border0);background:rgba(8,16,28,.58)">' +
          '<div style="font-family:Share Tech Mono,monospace;font-size:.62rem;letter-spacing:1px;color:var(--t3);text-transform:uppercase;margin-bottom:8px">Top 3 agents les plus en service</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:8px">' + topHtml + '</div>' +
        '</div>' +
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border0);background:rgba(8,16,28,.45)">' +
          '<div style="font-family:Share Tech Mono,monospace;font-size:.62rem;letter-spacing:1px;color:var(--t3);text-transform:uppercase;margin-bottom:6px">Agents sans service cette semaine · ' + missingAgents.length + '</div>' +
          '<div>' + missingHtml + '</div>' +
        '</div>' +
        '<div class="table-wrap"><table>' +
          '<thead><tr><th>AGENT</th><th>IBAN</th><th>TELEPHONE</th><th>PRISE - FIN</th><th style="text-align:center">DUREE</th><th style="text-align:center">SALAIRE</th><th style="text-align:center">RETRAIT</th><th style="text-align:center">PRIME</th><th style="text-align:center">TOTAL</th><th style="text-align:center">PAYE</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
  }).join('');

  var correctionsWarning = _pointeuseCorrectionsMissing
    ? '<div class="card" style="border-color:rgba(239,68,68,.45);margin-bottom:12px;padding:12px"><div class="flex-between" style="gap:12px;align-items:flex-start"><div><strong style="color:var(--red,#ff5b5b)">Table corrections manquante.</strong><p class="text-muted" style="margin:6px 0 0">Les retraits d heures seront locaux tant que la table Supabase <code>pointeuse_corrections</code> n existe pas. Si tu l as deja creee, execute le SQL complet puis recharge la page.</p></div><button class="btn btn-primary btn-sm" onclick="copyPointeuseCorrectionsSql()">Copier SQL</button></div></div>'
    : '';
  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Historique pointages</h1>' +
    '<p class="text-muted">' + weekKeys.length + ' semaine' + (weekKeys.length > 1 ? 's' : '') + ' enregistrée' + (weekKeys.length > 1 ? 's' : '') + '</p></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="navigate(\'pointeuse\')">← Retour</button></div>' +
    correctionsWarning +
    '<div>' + accordionHtml + '</div>'
  );
}

async function setCorrectionHisto(semaineKey, agentId, semaineLabel, agentMatricule, agentNom, value, input) {
  var hours = parseFloat(String(value || '').replace(',', '.'));
  if (!isFinite(hours)) hours = 0;
  var minutes = Math.round(hours * 60);
  if (input) input.disabled = true;
  try {
    if (_pointeuseCorrectionsMissing) {
      var localKey = 'corr_' + semaineKey + '_' + agentId;
      if (minutes) localStorage.setItem(localKey, String(minutes));
      else localStorage.removeItem(localKey);
      toast('Correction locale: table Supabase manquante.', 'error');
      await renderPointeuseHistorique();
      return;
    }
    if (minutes === 0) {
      var del = await DB.deletePointeuseCorrection(semaineKey, agentId);
      if (del.error) throw del.error;
      delete _pointeuseCorrections[pointeuseCorrectionKey(semaineKey, agentId)];
      toast('Correction d heures supprimee.', 'info');
    } else {
      var payload = {
        semaine_key: semaineKey,
        semaine_label: semaineLabel,
        agent_id: agentId,
        agent_matricule: agentMatricule,
        agent_nom: agentNom,
        minutes_retires: minutes,
        updated_by: currentPointeusePaidActor(),
        updated_at: new Date().toISOString()
      };
      var res = await DB.setPointeuseCorrection(payload);
      if (res.error) throw res.error;
      _pointeuseCorrections[pointeuseCorrectionKey(semaineKey, agentId)] = res.data || payload;
      toast(minutes > 0 ? 'Retrait applique: -' + fmtMinutesDuration(minutes) + '.' : 'Credit applique: +' + fmtMinutesDuration(Math.abs(minutes)) + '.', 'success');
    }
    await renderPointeuseHistorique();
  } catch(e) {
    toast('Erreur retrait heures: ' + (e.message || e), 'error');
    if (input) input.disabled = false;
  }
}

async function togglePaidHisto(semaineKey, agentId, semaineLabel, agentMatricule, agentNom, cb) {
  var checked = !!cb.checked;
  var row = cb.closest('tr');
  var previousOpacity = row ? row.style.opacity : '';
  if (row) row.style.opacity = checked ? '.5' : '';
  cb.disabled = true;
  try {
    if (_pointeusePaiementsMissing) {
      var legacyKey = 'paid_' + semaineKey + '_' + agentId;
      if (checked) localStorage.setItem(legacyKey, '1');
      else localStorage.removeItem(legacyKey);
      toast('Table paiements manquante: coche locale uniquement.', 'error');
      return;
    }
    var payload = {
      semaine_key: semaineKey,
      semaine_label: semaineLabel,
      agent_id: agentId,
      agent_matricule: agentMatricule,
      agent_nom: agentNom,
      paye: checked,
      checked_by: currentPointeusePaidActor(),
      checked_at: new Date().toISOString()
    };
    var res = await DB.setPointeusePaiement(payload);
    if (res.error) throw res.error;
    _pointeusePaiements[pointeusePaiementKey(semaineKey, agentId)] = res.data || payload;
    toast(checked ? 'Paiement marque paye.' : 'Paiement remis non paye.', checked ? 'success' : 'info');
  } catch(e) {
    cb.checked = !checked;
    if (row) row.style.opacity = previousOpacity;
    toast('Erreur paiement: ' + (e.message || e), 'error');
  } finally {
    cb.disabled = false;
  }
}

function copyIban(iban) {
  iban = String(iban || '').trim();
  if (!iban) { toast('Aucun IBAN a copier.', 'info'); return; }
  function done() { toast('IBAN copie.', 'success'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(iban).then(done).catch(function(){ fallbackCopyText(iban, done, 'Copie impossible, selectionne l IBAN manuellement.'); });
  } else {
    fallbackCopyText(iban, done, 'Copie impossible, selectionne l IBAN manuellement.');
  }
}

function copyTelephone(telephone) {
  telephone = String(telephone || '').trim();
  if (!telephone) { toast('Aucun telephone a copier.', 'info'); return; }
  function done() { toast('Telephone copie.', 'success'); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(telephone).then(done).catch(function(){ fallbackCopyText(telephone, done, 'Copie impossible, selectionne le telephone manuellement.'); });
  } else {
    fallbackCopyText(telephone, done, 'Copie impossible, selectionne le telephone manuellement.');
  }
}

function fallbackCopyText(text, onDone, errorMessage) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    if (onDone) onDone();
  } catch(e) {
    toast(errorMessage || 'Copie impossible, selectionne le texte manuellement.', 'error');
  }
  document.body.removeChild(ta);
}

async function setPrimeHisto(key, value) {
  var amount = parseMoneyInput(value);
  if (amount) localStorage.setItem(key, String(amount));
  else localStorage.removeItem(key);
  await renderPointeuseHistorique();
}

function toggleWeek(id) {
  var el = document.getElementById(id);
  var ico = document.getElementById(id + '_ico');
  if (!el) return;
  var open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'block';
  if (ico) ico.textContent = open ? '▼' : '▲';
  try { sessionStorage.setItem('histo_open_' + id, open ? '0' : '1'); } catch(e) {}
}

function fmtDuration(startIso) {
  var diff = Math.floor((Date.now() - new Date(startIso)) / 1000);
  var h = Math.floor(diff / 3600);
  var m = Math.floor((diff % 3600) / 60);
  return h + 'h' + (m < 10 ? '0' : '') + m;
}

function fmtSec(sec) {
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  return h + 'h' + (m < 10 ? '0' : '') + m;
}

async function changeRole(userId, role) {
  var r = await DB.updateAppUserRole(userId, role);
  if (r.error) { toast(r.error.message,'error'); return; }
  toast('Rôle mis à jour.','success');
}
