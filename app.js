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
  } catch(e) {}
})();

// ── State ──────────────────────────────────────────────────────────
var S = { user: null, appUser: null, role: 'agent', page: 'dashboard', pd: {}, discordRoles: [], discordUserId: null };

// ── Salaires par grade ($/h) ─────────────────────────────────────────
var GRADE_SALAIRE = {
  'Commandant':          700,
  'Capitaine':           600,
  'Lieutenant II':       550,
  'Lieutenant I':        500,
  'Sergeant II':         450,
  'Sergeant I':          400,
  'Senior Lead Officer': 300,
  'Trooper III':         250,
  'Trooper II':          200,
  'Trooper I':           150,
  'Rookie':              100
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
var TRACKED_DIVISIONS = ['CID','SWAT','PA','CNU','TU','SYND','LP'];

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

async function syncAllAgentsToDiscord() {
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

var NAV = [
  { id: 'dashboard', icon: '🏛️', label: 'Tableau de bord' },
  { id: 'ftf',      icon: '⚖️', label: 'Brigade FTF', ftfOnly: true },
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
  // wiki sections injected dynamically by loadWikiSections()
  { divider: true, staffOnly: true, _wikiEnd: true },
  { group: 'ADMINISTRATION', staffOnly: true },
  { id: 'archives',        icon: '🗃️', label: 'Archives',          staffOnly: true },
  { id: 'stats',           icon: '📈', label: 'Statistiques',       staffOnly: true },
  { id: 'settings',        icon: '⚙️', label: 'Mon compte',         staffOnly: true },
  { id: 'ceremonie',       icon: '🎖️', label: 'Prépa Cérémonie',    ceremonyOnly: true },
];

var PAGE_TITLES = {
  dashboard:'Tableau de bord', agents:'Agents', 'agent-profile':'Fiche agent',
  grades:'Grades', units:'Divisions', pointeuse:'Pointeuse', 'pointeuse-historique':'Historique pointages', mdt:'Guide MDT', vehicles:'Véhicules', cartes:'Cartes',
  info:'Informations', manuel:'Manuel', tenue:'Tenues', document:'Documents',
  archives:'Archives', ceremonie:'Prépa Cérémonie', completude:'Complétude fiches',
  'global-settings':'Réglages globaux',
  ftf:'FTF', stats:'Statistiques', search:'Recherche', settings:'Mon compte'
};

// ── Boot ───────────────────────────────────────────────────────────
(async function boot() {
  try {
    var { data: { session } } = await DB.getSession();
    if (session) { await afterLogin(session.user, session); }
    else { showLogin(); }
  } catch(e) { showLogin(); }
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
    if (roles.indexOf(ROLE_ACADEMY_ID) !== -1) return { role: 'academy', apiOk: true, roles: roles };
    if ((typeof ROLE_AGENT_IDS !== 'undefined' ? ROLE_AGENT_IDS : [ROLE_AGENT_ID]).some(function(r){ return roles.indexOf(r) !== -1; })) return { role: 'agent', apiOk: true, roles: roles };
    if (typeof ROLE_RH_ID !== 'undefined' && ROLE_RH_ID && roles.indexOf(ROLE_RH_ID) !== -1) return { role: 'rh', apiOk: true, roles: roles };
    if (typeof ROLE_VISITEUR_ID !== 'undefined' && ROLE_VISITEUR_ID && roles.indexOf(ROLE_VISITEUR_ID) !== -1) return { role: 'visiteur', apiOk: true, roles: roles };
    if (typeof FTF_ROLE_ID !== 'undefined' && FTF_ROLE_ID && FTF_ROLE_ID !== 'ID_DU_ROLE_ICI' && roles.indexOf(FTF_ROLE_ID) !== -1) return { role: 'ftf', apiOk: true, roles: roles };
    return { role: null, apiOk: true, roles: roles };
  } catch(e) { console.error('[auth] error:', e); return { role: null, apiOk: false, roles: [] }; }
}

async function afterLogin(user, session) {
  S.user = user;
  var discordIdentity = user.identities && user.identities.find(function(i){ return i.provider === 'discord'; });
  var discordUserId = (discordIdentity && (discordIdentity.id || (discordIdentity.identity_data && discordIdentity.identity_data.sub))) || (user.user_metadata && user.user_metadata.provider_id);
  S.discordUserId = discordUserId;
  console.log('[auth] identities:', user.identities, 'discordUserId:', discordUserId);
  var appUser = await DB.getAppUser(user.id);
  var result = await getDiscordRole(discordUserId);
  S.discordRoles = result.roles || [];
  if (result.role) {
    S.role = result.role;
    await DB.upsertAppUser({
      user_id: user.id,
      nom: (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.global_name || user.user_metadata.name)) || '',
      prenom: '',
      app_role: S.role
    });
  } else if (!result.apiOk && appUser && appUser.app_role) {
    S.role = appUser.app_role;
  } else {
    await DB.logout();
    showLogin();
    var errEl = document.getElementById('loginErr');
    if (errEl) { errEl.textContent = '⚠ Accès refusé — vous n\'avez pas les rôles requis sur le serveur Discord.'; errEl.classList.add('show'); }
    return;
  }
  _grades = await DB.getGrades();
  _units  = await DB.getUnits();
  await loadWikiSections();
  showApp();
  await navigate('dashboard');
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
  var VISITEUR_NAV = ['dashboard', 'pointeuse', 'cartes'];
  var RH_NAV = ['dashboard', 'agents', 'agent-profile', 'grades', 'units', 'pointeuse', 'cartes', 'stats', 'archives', 'recap', 'ceremonie', 'completude'];
  var html = '';
  NAV.forEach(function(item) {
    if (item.ftfOnly && !canAccessFTF()) return;
    if (isFtfOnly && item.id && item.id !== 'ftf') return;
    if (item.staffOnly && !isStaff) return;
    if (item.ceremonyOnly && !isCeremony) return;
    if (isVisiteur && item.id && !item.ftfOnly && VISITEUR_NAV.indexOf(item.id) === -1) return;
    if (S.role === 'rh' && item.id && !item.ftfOnly && RH_NAV.indexOf(item.id) === -1) return;
    if (item.divider) { html += '<div class="nav-divider"></div>'; return; }
    if (item.group)   { html += '<div class="nav-group">' + item.group + '</div>'; return; }
    html += '<div class="nav-item" data-page="' + item.id + '" onclick="navigate(\'' + item.id + '\')">' +
      '<span class="nav-icon">' + item.icon + '</span>' + esc(item.label) + '</div>';
  });
  document.getElementById('sidebarNav').innerHTML = html;

  var discordName = S.user && S.user.user_metadata && (S.user.user_metadata.full_name || S.user.user_metadata.name || S.user.user_metadata.user_name);
  var n = discordName || (S.appUser ? (S.appUser.prenom + ' ' + S.appUser.nom).trim() : S.user.email);
  var initials = n.split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
  var roleLabel = { admin:'ADMIN', academy:'SCA', agent:'AGENT', rh:'RH', visiteur:'VISITEUR', ftf:'FTF' }[S.role] || S.role.toUpperCase();
  document.getElementById('sidebarFooter').innerHTML =
    '<div class="sidebar-user">' +
      '<div class="sidebar-avatar">' + initials + '</div>' +
      '<div><div class="sidebar-uname">' + esc(n) + '</div><div class="sidebar-urole">' + roleLabel + '</div></div>' +
      '<button class="sidebar-logout" onclick="doLogout()" title="Déconnexion">⏻</button>' +
    '</div>';

  var chipName = S.serverNick || n;
  var chipInitials = chipName.split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
  document.getElementById('userChip').innerHTML =
    '<div class="user-chip-av">' + chipInitials + '</div>' +
    '<span class="user-chip-name">' + esc(chipName) + '</span>';
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
  S.page = page;
  S.pd = pd || {};
  updateUserUI();
  Object.values(_charts).forEach(function(c){ try{c.destroy();}catch(e){} });
  _charts = {};
  _quill = null;
  setContent('<div class="loader-block"><div class="spinner"></div><p>Chargement…</p></div>');
  var _permCfg = {}; try { _permCfg = JSON.parse(localStorage.getItem('sasp_permissions') || '{}'); } catch(e) {}
  var AGENT_ALLOWED   = _permCfg.agentPages   || ['dashboard','agents','agent-profile','grades','units','pointeuse','mdt','vehicles','cartes','info','manuel','tenue','document'];
  var ACADEMY_ALLOWED = _permCfg.academyPages  || null;
  if (page === 'ftf' && !canAccessFTF()) {
    setContent('<div class="empty-state"><div class="empty-icon">FTF</div><div class="empty-title">AccÃ¨s FTF restreint</div><div class="empty-sub">Cette page est rÃ©servÃ©e aux utilisateurs avec le rÃ´le Discord FTF.</div></div>');
    return;
  }
  if (S.role === 'ftf' && page !== 'ftf') {
    await navigate('ftf');
    return;
  }
  if ((S.role === 'agent' || S.role === 'academy' || S.role === 'visiteur') && page === 'ceremonie') {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div><div class="empty-sub">Cette section est réservée au Command Staff et aux Superviseurs.</div></div>');
    return;
  }
  var RH_ALLOWED = ['dashboard', 'agents', 'agent-profile', 'grades', 'units', 'pointeuse', 'cartes', 'stats', 'archives', 'recap', 'ceremonie'];
  if (S.role === 'rh' && page !== 'ftf' && RH_ALLOWED.indexOf(page) === -1) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div><div class="empty-sub">Cette section est réservée aux administrateurs.</div></div>');
    return;
  }
  var VISITEUR_ALLOWED = ['dashboard', 'pointeuse', 'cartes'];
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
      ceremonie:      renderCeremonie,
      archives:       renderArchives,
      completude:     renderCompletude,
      'global-settings': renderGlobalSettings,
      ftf:            renderFTF,
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
  if (S.role === 'admin') return true;
  return typeof FTF_ROLE_ID !== 'undefined' &&
    FTF_ROLE_ID &&
    FTF_ROLE_ID !== 'ID_DU_ROLE_ICI' &&
    (S.discordRoles || []).indexOf(FTF_ROLE_ID) !== -1;
}

// ── Utils ──────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
function isReferent(grade) {
  if (!grade || !_grades.length) return false;
  var offII = _grades.find(function(g){ return g.nom === 'Trooper II'; });
  if (!offII) return false;
  var g = _grades.find(function(g){ return g.nom === grade; });
  return g ? (g.ordre||0) >= (offII.ordre||0) : false;
}
function gradeBadge(g) {
  var pastille = (g === 'Rookie' || g === 'Trooper I') ? ' <span title="En formation" style="font-size:1.4em;vertical-align:middle">🎓</span>' : '';
  return '<span class="badge badge-gold">' + esc(g) + pastille + '</span>';
}
function referentBadge() {
  return '<span class="badge" style="background:rgba(46,204,113,.14);color:#2ecc71;border:1px solid rgba(46,204,113,.3);font-size:.68rem">📌 Référent</span>';
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
function gradeKey(v) { return normRosterText(v); }
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
var FTF_STATUSES = ['Attente paiement', '1ère convocation', '2ème convocation', '3ème convocation', 'Tribunal', 'Clôturé'];
var _ftfTab = 'dashboard';
var _ftfSearch = '';
var _ftfStatus = '';
var _ftfNotifyRunning = false;

function ftfLoadDossiers() {
  try {
    var data = JSON.parse(localStorage.getItem(FTF_STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch(e) { return []; }
}
function ftfSaveDossiers(list) {
  localStorage.setItem(FTF_STORAGE_KEY, JSON.stringify(list || []));
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
function ftfDeadlineStart(d) {
  if (!d) return '';
  if (d.statut === 'Attente paiement') return d.date_notification || d.date_statut || '';
  return d.date_statut || d.date_notification || '';
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
function ftfFilteredDossiers() {
  var q = (_ftfSearch || '').toLowerCase().trim();
  return ftfLoadDossiers().filter(function(d) {
    var name = ((d.nom || '') + ' ' + (d.prenom || '')).toLowerCase();
    return (!q || name.indexOf(q) !== -1) && (!_ftfStatus || d.statut === _ftfStatus);
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
function renderFTFStat(icon, label, value, sub) {
  return '<div class="ftf-stat"><div class="ftf-stat-top"><span>' + icon + '</span><strong>' + value + '</strong></div><div>' + esc(label) + '</div>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
}
async function renderFTF() {
  if (!canAccessFTF()) {
    setContent('<div class="empty-state"><div class="empty-icon">FTF</div><div class="empty-title">Acces FTF restreint</div><div class="empty-sub">Ajoutez l ID du role Discord FTF dans FTF_ROLE_ID pour autoriser cette page.</div></div>');
    return;
  }
  var dossiers = ftfLoadDossiers();
  var counts = {
    active: dossiers.filter(function(d){ return d.statut !== 'Clôturé'; }).length,
    c1: dossiers.filter(function(d){ return d.statut === '1ère convocation'; }).length,
    c2: dossiers.filter(function(d){ return d.statut === '2ème convocation'; }).length,
    c3: dossiers.filter(function(d){ return d.statut === '3ème convocation'; }).length,
    tribunal: dossiers.filter(function(d){ return d.statut === 'Tribunal'; }).length,
    closed: dossiers.filter(function(d){ return d.statut === 'Clôturé'; }).length
  };
  var body = _ftfTab === 'procedure' ? renderFTFProcedure() : (_ftfTab === 'dossiers' ? renderFTFDossiers() : renderFTFDashboard(counts));
  setContent(
    '<div class="ftf-page">' +
      '<div class="ftf-hero">' +
        '<div><div class="ftf-kicker">SASP · BRIGADE FTF</div><h1>Financial Task Force</h1><p>Suivi des amendes impayees, convocations et transmissions tribunal.</p></div>' +
        '<div class="ftf-seal">FTF</div>' +
      '</div>' +
      '<div class="ftf-tabs">' +
        ftfTabButton('dashboard', 'Tableau de bord', '01') +
        ftfTabButton('procedure', 'Procedure', '02') +
        ftfTabButton('dossiers', 'Dossiers', '03') +
      '</div>' +
      body +
    '</div>'
  );
  ftfCheckConvocationNotifications();
}
function renderFTFDashboard(counts) {
  return '<div class="ftf-grid">' +
    renderFTFStat('□', 'Dossiers actifs', counts.active, 'hors dossiers clotures') +
    renderFTFStat('1', 'Convocation 1', counts.c1, '+25 pourcent') +
    renderFTFStat('2', 'Convocation 2', counts.c2, '+75 pourcent') +
    renderFTFStat('3', 'Convocation 3', counts.c3, '+125 pourcent') +
    renderFTFStat('⚖', 'A presenter au tribunal', counts.tribunal, 'phase judiciaire') +
    renderFTFStat('✓', 'Dossiers clotures', counts.closed, 'procedure terminee') +
  '</div>';
}
function renderFTFProcedure() {
  var steps = [
    ['Amende notifiee par le SASP', 'La personne recoit la notification officielle de l amende.'],
    ['7 jours pour payer', 'Le delai de paiement initial est fixe a 7 jours.'],
    ['Paiement effectue', 'Si le paiement est fait, la procedure est terminee.'],
    ['Non-paiement', 'Si le paiement n est pas fait, le dossier est transfere a la FTF.'],
    ['1ère convocation', 'Majoration de 25 pourcent, nouveau delai de 7 jours, non-presentation = 5 000 $.'],
    ['2ème convocation', 'Majoration de 75 pourcent, nouveau delai de 7 jours, non-presentation = 5 000 $.'],
    ['3ème convocation', 'Majoration de 125 pourcent, nouveau delai de 7 jours, non-presentation = 5 000 $.'],
    ['Apres 3 convocations', 'Localisation, interpellation, presentation au tribunal et saisie des biens.'],
    ['Insolvabilite', 'Echeancier, TIG SASP/SAMC, pointage quotidien ou prison selon la decision.']
  ];
  return '<div class="ftf-procedure">' + steps.map(function(s, i) {
    return '<div class="ftf-step"><div class="ftf-step-index">' + (i + 1) + '</div><div><h3>' + esc(s[0]) + '</h3><p>' + esc(s[1]) + '</p></div></div>';
  }).join('') + '</div>';
}
function ftfIsNotificationDue(d) {
  if (!d || d.convocation_validee) return false;
  var next = ftfNextStep(d.statut);
  if (!next) return false;
  var start = ftfDeadlineStart(d);
  if (!start) return false;
  var today = ftfTodayKey();
  var due = ftfAddDays(start, 6);
  var sentKey = d.statut + '|' + today;
  return today >= due && (!d.notif_sent || d.notif_sent[sentKey] !== true);
}
async function ftfCheckConvocationNotifications() {
  if (_ftfNotifyRunning || !canAccessFTF()) return;
  _ftfNotifyRunning = true;
  try {
    var dossiers = ftfLoadDossiers();
    var changed = false;
    for (var i = 0; i < dossiers.length; i++) {
      var d = dossiers[i];
      if (!ftfIsNotificationDue(d)) continue;
      var today = ftfTodayKey();
      var sentKey = d.statut + '|' + today;
      var res = await fetch(WORKER_BASE + '/ftf/convocation-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
        body: JSON.stringify({
          dossier_id: d.id,
          creator_id: d.created_by_discord_id || S.discordUserId || '',
          suspect: ((d.prenom || '') + ' ' + (d.nom || '')).trim(),
          current_status: d.statut,
          next_step: ftfNextStep(d.statut),
          date_statut: ftfDeadlineStart(d),
          due_date: ftfAddDays(ftfDeadlineStart(d), 7)
        })
      });
      if (res.ok) {
        d.notif_sent = d.notif_sent || {};
        d.notif_sent[sentKey] = true;
        changed = true;
      }
    }
    if (changed) ftfSaveDossiers(dossiers);
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
  var rows = list.length ? list.map(function(d) {
    return '<tr onclick="openFtfDossierModal(\'' + esc(d.id) + '\')">' +
      '<td><strong>' + esc((d.prenom || '') + ' ' + (d.nom || '')) + '</strong><div class="text-muted" style="font-size:.72rem">' + esc(d.date_notification || '') + '</div></td>' +
      '<td>' + fmtMoney(Number(d.montant_initial || 0)) + '</td>' +
      '<td>' + ftfStatusBadge(d.statut) + '</td>' +
      '<td><strong class="text-gold">' + fmtMoney(ftfAmount(d)) + '</strong></td>' +
      '<td class="text-muted">' + esc((d.notes || '').slice(0, 80)) + '</td>' +
    '</tr>';
  }).join('') : '<tr><td colspan="5"><div class="empty-state" style="padding:28px"><div class="empty-icon">FTF</div><div class="empty-title">Aucun dossier FTF</div></div></td></tr>';
  return '<div class="card ftf-dossiers-card">' +
    '<div class="flex-between mb-20"><div><h2 style="font-size:1.2rem">Dossiers FTF</h2><p class="text-muted" style="font-size:.82rem">Date 1ere amende / delit = depart du premier delai. Apres chaque convocation, la date du statut relance le delai suivant.</p>' + (pendingAlerts ? '<p class="text-gold" style="font-size:.82rem;margin-top:4px">' + pendingAlerts + ' rappel(s) convocation en attente.</p>' : '') + '</div><button class="btn btn-primary btn-sm" onclick="openFtfDossierModal()">Creer un dossier</button></div>' +
    '<div class="ftf-toolbar">' +
      '<input class="form-control" value="' + esc(_ftfSearch) + '" oninput="ftfSetSearch(this.value)" placeholder="Rechercher par nom ou prenom">' +
      '<select class="form-control" onchange="ftfSetStatus(this.value)">' + statusOptions + '</select>' +
    '</div>' +
    '<div class="table-wrap"><table><thead><tr><th>PERSONNE</th><th>MONTANT INITIAL</th><th>STATUT</th><th>MONTANT ACTUEL</th><th>NOTES FTF</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
  '</div>';
}
function openFtfDossierModal(id) {
  var dossiers = ftfLoadDossiers();
  var d = id ? dossiers.find(function(x){ return x.id === id; }) : null;
  var isEdit = !!d;
  d = d || { nom:'', prenom:'', montant_initial:'', date_notification:ftfTodayKey(), date_statut:ftfTodayKey(), statut:'Attente paiement', convocation_validee:false, notes:'' };
  if (!d.date_statut) d.date_statut = d.date_notification || ftfTodayKey();
  var statusSelect = '<div class="form-group"><label class="form-label">Statut</label><select class="form-control" id="ftfStatut">' +
    FTF_STATUSES.map(function(s){ return '<option value="' + esc(s) + '"' + (d.statut === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
    '</select></div>';
  var validatedSelect = '<div class="form-group"><label class="form-label">Convocation validée ?</label><select class="form-control" id="ftfConvocationValidee">' +
    '<option value="false"' + (!d.convocation_validee ? ' selected' : '') + '>Non - continuer les rappels</option>' +
    '<option value="true"' + (d.convocation_validee ? ' selected' : '') + '>Oui - arrêter les rappels</option>' +
    '</select></div>';
  validatedSelect = '<div class="form-group"><label class="form-label">Convocation traitee ?</label><select class="form-control" id="ftfConvocationValidee">' +
    '<option value="false" selected>Non</option>' +
    '<option value="true">Oui - passer a l etape suivante</option>' +
    '</select></div>';
  openModal({
    eyebrow: 'DOSSIER FTF',
    title: isEdit ? 'Modifier le dossier' : 'Creer un dossier',
    size: 'md',
    body:
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        fld('Nom *','text','ftfNom',d.nom,'Nom') +
        fld('Prenom *','text','ftfPrenom',d.prenom,'Prenom') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        fld('Montant initial *','number','ftfMontant',d.montant_initial,'15000') +
        fld('Date 1ere amende / delit','date','ftfDate',d.date_notification,'') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<input type="hidden" id="ftfDateStatut" value="' + esc(d.date_statut || '') + '">' +
        validatedSelect +
      '</div>' +
      statusSelect +
      '<div class="form-group"><label class="form-label">Notes FTF</label><textarea class="form-control" id="ftfNotes" placeholder="Notes internes FTF">' + esc(d.notes || '') + '</textarea></div>',
    footer:
      (isEdit ? '<button class="btn btn-danger" onclick="deleteFtfDossier(\'' + esc(d.id) + '\')">Supprimer</button>' : '') +
      '<button class="btn btn-ghost" onclick="closeModal()">Annuler</button>' +
      '<button class="btn btn-primary" onclick="saveFtfDossier(' + (isEdit ? '\'' + esc(d.id) + '\'' : 'null') + ')">Sauvegarder</button>'
  });
}
function saveFtfDossier(id) {
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
    created_by_discord_id: (previous && previous.created_by_discord_id) || S.discordUserId || '',
    notif_sent: (statusChanged || advanceStep) ? {} : ((previous && previous.notif_sent) || {}),
    notes: document.getElementById('ftfNotes').value || '',
    updated_at: new Date().toISOString()
  };
  if (id) dossiers = dossiers.map(function(d){ return d.id === id ? Object.assign({}, d, data) : d; });
  else dossiers.unshift(data);
  ftfSaveDossiers(dossiers);
  closeModal();
  toast('Dossier FTF sauvegarde.', 'success');
  renderFTF();
}
function deleteFtfDossier(id) {
  if (!confirm('Supprimer ce dossier FTF ?')) return;
  ftfSaveDossiers(ftfLoadDossiers().filter(function(d){ return d.id !== id; }));
  closeModal();
  toast('Dossier FTF supprime.', 'info');
  renderFTF();
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
  var topGrades = gradesSorted.map(function(g){ return [g.nom, gradeCounts[gradeKey(g.nom)]||0]; });

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
      '<span style="font-size:.7rem;font-weight:800;color:' + ac.text + ';letter-spacing:1.4px;text-transform:uppercase">' + esc(g.nom) + '</span>' +
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

// ══ AGENTS ════════════════════════════════════════════════════════
async function renderAgents() {
  if (!_grades.length) _grades = await DB.getGrades();
  var agents = await DB.getAgents(_agentFilters);

  var gradeOpts = '<option value="">Tous les grades</option>' +
    _grades.map(function(g){ return '<option value="' + esc(g.nom) + '"' + (_agentFilters.grade===g.nom?' selected':'') + '>' + esc(g.nom) + '</option>'; }).join('');
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
      '<td>' + gradeBadge(a.grade) + (isReferent(a.grade) ? referentBadge() : '') + '</td>' +
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
        (isAdmin() ? '<button class="btn btn-ghost btn-sm" onclick="syncAllAgentsToDiscord()">🔄 Sync Discord</button>' : '') +
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
  var ag = id ? await DB.getAgent(id) : null;
  var formateurs = await DB.getFormateurs();
  var v = ag || {};

  var currentGradeKey = gradeKey(v.grade);
  var gradeInList = _grades.some(function(g){ return gradeKey(g.nom) === currentGradeKey; });
  var gradeOpts = (v.grade && !gradeInList ? '<option value="' + esc(v.grade) + '" selected>' + esc(v.grade) + '</option>' : '') +
    _grades.map(function(g){
      return '<option value="' + esc(g.nom) + '"' + (currentGradeKey && currentGradeKey===gradeKey(g.nom)?' selected':'') + '>' + esc(g.nom) + '</option>';
    }).join('');

  var uniteChecks = _units.filter(function(u){ return u.code !== 'LP'; }).map(function(u){
    var chk = (v.unites||[]).includes(u.code) ? ' checked' : '';
    return '<label class="form-check"><input type="checkbox" name="unite" value="' + esc(u.code) + '"' + chk + '><span class="form-check-lbl">' + esc(u.code) + ' — ' + esc(u.nom) + '</span></label>';
  }).join('');

  var formateurOpts = '<option value="">— Aucun formateur assigné —</option>' +
    formateurs.filter(function(f){ return f.id !== id; }).map(function(f){
      return '<option value="' + f.id + '"' + (v.formateur_id === f.id ? ' selected' : '') + '>' +
        esc(f.matricule + ' — ' + f.prenom + ' ' + f.nom) + '</option>';
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
        fld('Matricule *', 'text', 'agMatricule', v.matricule, 'Ex: SASP-001') +
        fld('Date de naissance', 'date', 'agDob', v.date_naissance) +
      '</div>' +
      '<div class="form-group"><label class="form-label">Téléphone</label><input class="form-control" type="text" id="agTel" value="' + esc(fmtTel(v.telephone)||'') + '" placeholder="(555) 0000" oninput="formatTel(this)" maxlength="11"></div>' +
      fld('IBAN', 'text', 'agIban', v.iban||'', 'Ex : 524156435465413') +
      '<div class="form-grid2">' +
        '<div class="form-group"><label class="form-label">Grade *</label><select class="form-control" id="agGrade">' + gradeOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Statut</label><select class="form-control" id="agStatut">' +
          ['En service','En congé','Suspendu','Licencié','Retraité','Démission','Archivé'].map(function(s){ return '<option' + (v.statut===s?' selected':'') + '>' + s + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="form-grid2">' +
        fld('Date de recrutement', 'date', 'agRecruit', v.date_recrutement) +
        fld('Date de dernière promotion', 'date', 'agPromo', v.date_promotion) +
      '</div>' +
      '<div class="form-group"><label class="form-label">Unités</label>' +
        '<div class="flex flex-wrap gap-12">' + uniteChecks + '</div>' +
      '</div>' +
      '<div class="form-group"><label class="form-label">Formateur assigné</label>' +
        '<select class="form-control" id="agFormateur">' + formateurOpts + '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label class="form-check" style="align-items:flex-start">' +
          '<input type="checkbox" id="agIsFormateur"' + (v.is_formateur ? ' checked' : '') + ' style="margin-top:3px">' +
          '<span class="form-check-lbl">🎓 Agent formateur — apparaît dans la liste des formateurs assignables</span>' +
        '</label>' +
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
    notes: document.getElementById('agNotes').value.trim() || null,
    is_formateur: document.getElementById('agIsFormateur').checked,
    formateur_id: document.getElementById('agFormateur').value || null,
    discord_id: document.getElementById('agDiscordId').value.trim() || null
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
      }
      if (!!old.is_formateur !== !!data.is_formateur) diffLines.push('Formateur : ' + (old.is_formateur?'Oui':'Non') + ' → ' + (data.is_formateur?'Oui':'Non'));
      if ((old.iban||'') !== (data.iban||'')) diffLines.push('IBAN : ' + (old.iban||'—') + ' → ' + (data.iban||'—'));
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
  ]);
  var formateur = ag && ag.formateur_id ? await DB.getAgent(ag.formateur_id) : null;
  if (!ag) { navigate('agents'); return; }

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
        '<div class="profile-meta">' + gradeBadge(ag.grade) + (isReferent(ag.grade) ? referentBadge() : '') + statusBadge(ag.statut) + unites + '</div>' +
      '</div>' +
      (ag.statut === 'Archivé' ?
        '<div class="profile-actions"><span class="badge badge-red" style="font-size:.8rem;padding:6px 14px">🗃️ Archivé — lecture seule</span></div>' :
        canWrite() ?
          '<div class="profile-actions">' +
            '<button class="btn btn-outline btn-sm" onclick="openAgentModal(\'' + id + '\')">✏️ Modifier</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="syncDiscordToAgent(\'' + id + '\')" title="Sync divisions depuis Discord">🔄 Sync Discord</button>' +
            (isAdmin() ? '<button class="btn btn-ghost btn-sm" style="color:var(--t3)" onclick="archiveAgent(\'' + id + '\')">🗃️ Archiver</button>' : '') +
          '</div>' : '') +
    '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">' +
      '<div style="display:contents">' +

        '<div class="card">' +
          '<div class="card-head"><div class="card-icon">👤</div><div><div class="card-title">Informations' + (ag.is_formateur ? ' <span class="badge badge-blue" style="font-size:.65rem;margin-left:6px">🎓 Formateur</span>' : '') + '</div></div></div>' +
          infoRow('Date de naissance', fmt(ag.date_naissance)) +
          infoRow('Téléphone', fmtTel(ag.telephone)) +
          infoRow('Date de recrutement', fmt(ag.date_recrutement)) +
          infoRow('Dernière promotion', fmt(ag.date_promotion)) +
          (ag.iban ? infoRow('IBAN', ag.iban) : '') +
          (formateur ? infoRow('Formateur', '<span onclick="navigate(\'agent-profile\',{id:\'' + formateur.id + '\'})" style="color:var(--blue);cursor:pointer">🎓 ' + esc(formateur.prenom + ' ' + formateur.nom) + ' (' + esc(formateur.matricule) + ')</span>') : '') +
        '</div>' +

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
  var ppas = [{ level:0, label:'Sans PPA (Taser)' }];
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
          ['Taser','Glock','MP5','Fusil à pompe','Fusil carabine'].map(function(w){
            var isTaser = w === 'Taser';
            return '<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById(\'armeNom\').value=\'' + w + '\';' + (isTaser ? 'document.getElementById(\'armeNiveau\').value=\'0\'' : '') + '">' + w + '</button>';
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
      '<td style="font-weight:600;color:var(--t0)">' + esc(g.nom) + '</td>' +
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
    var colors = { PA:'blue', CID:'orange', SWAT:'red', TU:'green', PRD:'gold' };
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
async function renderCompletude() {
  var agents = await DB.getAgents({});
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

  setContent(
    '<div class="flex-between mb-20 flex-wrap gap-8">' +
      '<div>' +
        '<h2 style="font-size:1.15rem;font-weight:700;color:var(--t0);margin:0">Complétude des fiches agents</h2>' +
        '<div style="font-size:.78rem;color:var(--t3);margin-top:3px">' + agents.length + ' agents actifs — ' +
          '<span style="color:' + (incomplete?'#e74c3c':'#2ecc71') + '">' + incomplete + ' fiche' + (incomplete!==1?'s':'') + ' incomplète' + (incomplete!==1?'s':'') + '</span>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" onclick="navigate(\'agents\')">← Retour agents</button>' +
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
    '</div>'
  );
}

// ══ DISCIPLINARY ═══════════════════════════════════════════════════
// ══ ARCHIVES ════════════════════════════════════════════════════════
var _archiveSearch = '';
async function renderArchives() {
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
      return '<div class="card" style="cursor:pointer;transition:border-color .15s" onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})" onmouseover="this.style.borderColor=\'var(--gold)\'" onmouseout="this.style.borderColor=\'\'">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">' +
          '<div>' +
            '<div style="font-size:1rem;font-weight:700;color:var(--t0)">' + esc(a.prenom + ' ' + a.nom) + '</div>' +
            '<div style="font-size:1.1rem;font-weight:800;color:var(--gold);font-family:\'Share Tech Mono\',monospace;margin-top:3px;letter-spacing:.06em;text-shadow:0 0 8px rgba(201,168,76,.35)">#' + esc(a.matricule) + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
            gradeBadge(a.grade) +
            (isReferent(a.grade) ? referentBadge() : '') +
            statusBadge(a.statut) +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:.78rem;border-top:1px solid var(--border0);padding-top:10px">' +
          recapRow('📞', a.telephone ? fmtTel(a.telephone) : '—') +
          recapRow('💳', a.iban || '—') +
          recapRow('🎓', formateur ? formateur.prenom + ' ' + formateur.nom : '—') +
          recapRow('📅', a.date_recrutement ? fmt(a.date_recrutement) : '—') +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;border-top:1px solid var(--border0);padding-top:10px">' +
          '<div style="display:flex;gap:6px">' + divs + '</div>' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            (blameCount ? '<span class="badge badge-red" style="font-size:.68rem">⚠️ ' + blameCount + ' blâme' + (blameCount>1?'s':'') + '</span>' : '') +
            (a.notes ? '<span title="' + esc(a.notes.slice(0,80)) + '" style="font-size:.75rem;color:var(--t3);cursor:help">📝</span>' : '') +
          '</div>' +
        '</div>' +
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
      return '<option value="' + esc(g.nom) + '">' + esc(g.nom) + '</option>';
    }).join('');
  var statutOpts = ['Tous les statuts','En service','En congé','Suspendu','Licencié','Retraité','Démission'].map(function(s,i){
    return '<option value="' + (i===0?'':s) + '">' + s + '</option>';
  }).join('');

  setContent(
    '<div class="welcome-bar"><div><h1 style="font-size:1.5rem">Récap agents</h1><p class="text-muted" style="font-size:.84rem;margin-top:3px">Vue d\'ensemble — toutes les informations</p></div></div>' +
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

async function archiveAgent(id) {
  if (!confirm('Archiver cet agent ? Sa fiche passera en lecture seule et disparaîtra de la liste des agents.')) return;
  var r = await DB.updateAgent(id, { statut: 'Archivé' });
  if (r.error) { toast(r.error.message, 'error'); return; }
  toast('Agent archivé.', 'info');
  var agent = await DB.getAgent(id);
  if (agent) sendLog('📦 Agent archivé', 0xe67e22, [
    { name: 'Agent', value: agent.prenom + ' ' + agent.nom + ' · ' + agent.matricule, inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  refreshAgentList();
  navigate('archives');
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
      '<input class="form-control search-input" id="globalSearchInput" placeholder="Rechercher agents, grades, dossiers, MDT…" value="' + esc(q) + '" oninput="globalSearch(this.value)" style="font-size:1rem;padding:13px 13px 13px 38px">' +
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
  var { agents, mdt } = await DB.search(q);

  var html = '';
  if (agents.length) {
    html += '<div class="card mb-14"><div class="card-head"><div class="card-icon">👮</div><div><div class="card-title">Agents</div><div class="card-sub">' + agents.length + ' RÉSULTAT(S)</div></div></div>' +
      agents.map(function(a){ return '<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border0);cursor:pointer" onclick="navigate(\'agent-profile\',{id:\'' + a.id + '\'})">' +
        '<span class="mono text-gold">' + esc(a.matricule) + '</span>' +
        '<span style="font-weight:600;color:var(--t0);flex:1">' + esc(a.prenom+' '+a.nom) + '</span>' +
        gradeBadge(a.grade) + statusBadge(a.statut) +
      '</div>'; }).join('') + '</div>';
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

// ══ GLOBAL SETTINGS ═══════════════════════════════════════════════
async function renderGlobalSettings() {
  if (!isAdmin()) { toast('Accès réservé aux administrateurs.','error'); return; }
  var appUsers = await DB.getAppUsers();
  var grades   = await DB.getGrades();
  var units    = await DB.getUnits();
  var archived = await DB.getArchivedAgents('');

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
        '<span style="font-size:.83rem;color:var(--t1);font-weight:600">' + esc(g.nom) + '</span>' +
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
    { id:'search',        label:'Recherche',    staffDefault:true },
    { id:'archives',      label:'Archives',     staffDefault:true }
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

  // ── Zone de danger ──
  var dangerHtml = '<p style="font-size:.83rem;color:var(--t2);margin-bottom:14px">' + archived.length + ' agent(s) dans les archives.</p>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button class="btn btn-outline btn-sm" onclick="navigate(\'archives\')">🗃️ Voir les archives</button>' +
      (archived.length ? '<button class="btn btn-danger btn-sm" onclick="purgeAllArchives()">💀 Purger toutes les archives</button>' : '') +
    '</div>';

  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Réglages globaux</h1><p class="text-muted" style="font-size:.82rem;margin-top:3px">Configuration générale du site — accès admin uniquement</p></div></div>' +
    section('👥', 'Gestion des accès', 'RÔLES DES UTILISATEURS', usersHtml) +
    section('🎖️', 'Grades', 'HIÉRARCHIE', gradesHtml) +
    section('🚔', 'Divisions', 'UNITÉS DE LA SASP', unitsHtml) +
    section('📚', 'Documentation', 'SECTIONS DU MENU', docsHtml) +
    section('🔐', 'Permissions & Rôles Discord', 'CONTRÔLE D\'ACCÈS', permHtml) +
    section('⚠️', 'Zone de danger', 'ACTIONS IRRÉVERSIBLES', dangerHtml)
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
  var allPageIds = ['dashboard','agents','grades','units','mdt','vehicles','info','manuel','tenue','document','stats','search','archives'];
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
    var since = actif ? fmtDuration(actif.clock_in) : '';
    var priseHtml = actif
      ? '<strong class="text-gold">' + fmtClock(actif.clock_in) + '</strong><br><small style="color:var(--t3)">' + fmt(actif.clock_in) + '</small>'
      : (last ? '<span>' + fmtClock(last.clock_in) + '</span><br><small style="color:var(--t3)">' + fmt(last.clock_in) + '</small>' : '<span style="color:var(--t3)">—</span>');
    var finHtml = actif
      ? '<span class="badge badge-green">En cours</span>'
      : (lastClosed ? '<span>' + fmtClock(lastClosed.clock_out) + '</span><br><small style="color:var(--t3)">' + fmt(lastClosed.clock_out) + '</small>' : '<span style="color:var(--t3)">—</span>');
    var statusHtml = actif
      ? '<span class="badge badge-green">En service · ' + since + '</span>'
      : '<span class="badge badge-gray">Hors service</span>';
    var forceBtn = (actif && canWrite())
      ? ' <button class="btn btn-ghost btn-sm" style="color:#e74c3c;border-color:rgba(231,76,60,.3)" onclick="forceClockOut(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.matricule) + '\')" title="Forcer fin de service">🛑</button>'
      : '';
    var btnHtml = actif
      ? '<button class="btn btn-danger btn-sm" onclick="doClockOut(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.matricule) + '\')">⏹ Sortie</button>' + forceBtn
      : '<button class="btn btn-primary btn-sm" onclick="doClockIn(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.matricule) + '\')">▶ Entrée</button>';
    return '<tr>' +
      '<td>' + gradeBadge(a.grade) + '</td>' +
      '<td><strong>' + esc(a.prenom + ' ' + a.nom) + '</strong><br><small style="color:var(--t3)">' + esc(a.matricule) + '</small></td>' +
      '<td>' + statusHtml + '</td>' +
      '<td>' + priseHtml + '</td>' +
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
        '<thead><tr><th>GRADE</th><th>AGENT</th><th>STATUT</th><th>PRISE SERVICE</th><th>FIN SERVICE</th><th>ACTION</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:var(--t3)">Aucun agent</td></tr>') + '</tbody>' +
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
  var { error } = await DB.clockIn(agentId);
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast('Entrée enregistrée', 'success');
  sendLog('🟢 Prise de service', 0x27ae60, [
    { name: 'Agent', value: (agentName || '—') + (matricule ? ' · ' + matricule : ''), inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  await renderPointeuse();
}

async function doClockOut(agentId, agentName, matricule) {
  var p = _pointageActifs[agentId];
  if (!p) return;
  var { error } = await DB.clockOut(p.id);
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast('Sortie enregistrée', 'success');
  sendLog('🔴 Fin de service', 0x7f8c8d, [
    { name: 'Agent', value: (agentName || '—') + (matricule ? ' · ' + matricule : ''), inline: true },
    { name: 'Par', value: _whoAmI(), inline: true }
  ]);
  await renderPointeuse();
}

// ══ CÉRÉMONIE ═════════════════════════════════════════════════════

function _myDiscordId() {
  if (!S.user) return null;
  var identity = S.user.identities && S.user.identities.find(function(i){ return i.provider === 'discord'; });
  return (identity && (identity.id || (identity.identity_data && identity.identity_data.sub))) ||
         (S.user.user_metadata && S.user.user_metadata.provider_id) || null;
}

async function renderCeremonie() {
  var [agents, votes] = await Promise.all([DB.getAgents(), DB.getCeremonieVotes()]);
  var votesByAgent = {};
  votes.forEach(function(v) {
    if (!votesByAgent[v.agent_id]) votesByAgent[v.agent_id] = [];
    votesByAgent[v.agent_id].push(v);
  });
  var myId = _myDiscordId();
  var isCmd = S.role === 'admin';

  var sorted = agents.slice().sort(function(a, b) {
    var ga = _grades.find(function(g){ return g.nom === a.grade; });
    var gb = _grades.find(function(g){ return g.nom === b.grade; });
    return ((gb&&gb.ordre)||0) - ((ga&&ga.ordre)||0);
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

  // Lignes agents
  var rows = sorted.map(function(a) {
    var av = votesByAgent[a.id] || [];
    var myVote = av.find(function(v){ return v.voter_discord_id === myId; });

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
        if (pCount === av.length) {
          applyHtml = '<button class="btn btn-primary btn-sm" style="font-size:.72rem;white-space:nowrap" onclick="applyCeremonieDecision(\'' + aid + '\',\'promotion\',\'' + an + '\',\'' + ag + '\')">✅ Appliquer</button>';
        } else if (rCount === av.length) {
          applyHtml = '<button class="btn btn-danger btn-sm" style="font-size:.72rem;white-space:nowrap" onclick="applyCeremonieDecision(\'' + aid + '\',\'retrogradation\',\'' + an + '\',\'' + ag + '\')">✅ Appliquer</button>';
        }
      }
    }

    var voteBtn = '<button class="btn btn-ghost btn-sm" onclick="openCeremonieVoteModal(\'' + a.id + '\',\'' + esc(a.prenom+' '+a.nom) + '\',\'' + esc(a.grade||'') + '\')">' + (myVote ? '✏️ Modifier' : '🗳️ Voter') + '</button>';

    var row = '<tr>' +
      '<td><span style="font-family:\'Share Tech Mono\',monospace;color:var(--gold);font-size:.85rem">#' + esc(a.matricule||'—') + '</span></td>' +
      '<td><strong>' + esc(a.prenom + ' ' + a.nom) + '</strong></td>' +
      '<td>' + gradeBadge(a.grade) + '</td>' +
      '<td>' + myVoteHtml + '</td>';
    if (isCmd) row += '<td style="max-width:260px">' + allVotesHtml + '</td><td>' + applyHtml + '</td>';
    row += '<td>' + voteBtn + '</td></tr>';
    return row;
  }).join('');

  var theadExtra = isCmd ? '<th>TOUS LES AVIS</th><th></th>' : '';
  setContent(
    '<div class="flex-between mb-20">' +
      '<div><h1 style="font-size:1.4rem">🎖️ Préparation Cérémonie</h1>' +
      '<p class="text-muted">Votes de grade — session en cours</p></div>' +
    '</div>' +
    debriefHtml +
    '<div class="card">' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>#</th><th>AGENT</th><th>GRADE ACTUEL</th><th>MON AVIS</th>' + theadExtra + '<th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>' +
    '</div>'
  );
}

function openCeremonieVoteModal(agentId, agentName, grade) {
  window._cVoteId = agentId;
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
  if (!decision) { toast('Sélectionne une décision', 'error'); return; }
  if (decision === 'retrogradation' && !commentaire) { toast('Commentaire obligatoire pour une rétrogradation', 'error'); return; }
  var myId = _myDiscordId();
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
    body: '<p style="color:var(--t1)">Tous les votes de la session seront supprimés définitivement.</p>',
    footer: '<button class="btn btn-ghost btn-sm" onclick="closeModal()">Annuler</button>' +
            '<button class="btn btn-danger btn-sm" onclick="closeModal();confirmResetCeremonieVotes()">Supprimer</button>'
  });
}

async function confirmResetCeremonieVotes() {
  var { error } = await DB.deleteCeremonieVotes();
  if (error) { toast('Erreur : ' + error.message, 'error'); return; }
  toast('Votes réinitialisés', 'success');
  await renderCeremonie();
}

// ══ CARTES ════════════════════════════════════════════════════════
function renderCartes() {
  setContent(
    '<div style="display:flex;flex-direction:column;height:calc(100vh - 60px);margin:-24px">' +
      '<iframe src="carte.html?v=3" style="flex:1;border:none;width:100%;height:100%;" allowfullscreen></iframe>' +
    '</div>'
  );
}

// ══ HISTORIQUE POINTAGES ══════════════════════════════════════════
async function renderPointeuseHistorique() {
  if (!canWrite()) {
    setContent('<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">Accès restreint</div></div>');
    return;
  }
  var [all, actives] = await Promise.all([DB.getAllPointages(), DB.getActivePointages()]);
  var activeAgentIds = new Set(actives.map(function(p){ return p.agent_id; }));

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
    agentList.forEach(function(e) {
      var a = e.agent || {};
      var agentKey = a.id || a.matricule || ((a.prenom || '') + (a.nom || ''));
      var primeKey = 'prime_' + key + '_' + agentKey;
      var prime = parseMoneyInput(localStorage.getItem(primeKey));
      totalSec += e.sec;
      totalPrimes += prime;
      totalSalaire += calcSalaire(a.grade, e.sec) + prime;
    });

    var rows = agentList.map(function(entry) {
      var a = entry.agent;
      var sec = entry.sec;
      var sal = calcSalaire(a.grade, sec);
      var agentKey = a.id || a.matricule || ((a.prenom || '') + (a.nom || ''));
      var primeKey = 'prime_' + key + '_' + agentKey;
      var prime = parseMoneyInput(localStorage.getItem(primeKey));
      var totalAgent = sal + prime;
      var paidKey = 'paid_' + key + '_' + (a.id || a.matricule || (a.prenom + a.nom));
      var isPaid = localStorage.getItem(paidKey) === '1';
      var enService = a.id && activeAgentIds.has(a.id);
      var dot = '<span title="' + (enService ? 'En service' : 'Hors service') + '" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + (enService ? '#2ecc71' : '#e74c3c') + ';box-shadow:0 0 ' + (enService ? '6px #2ecc71' : '0px') + '"></span>';
      var sessionsHtml = (entry.sessions || []).slice(0, 4).map(function(p) {
        return '<div style="white-space:nowrap;font-family:monospace;font-size:.75rem;color:var(--t2)">' +
          fmtClock(p.clock_in) + ' → ' + (p.clock_out ? fmtClock(p.clock_out) : '<span style="color:var(--gold)">en cours</span>') +
        '</div>';
      }).join('');
      return '<tr style="' + (isPaid ? 'opacity:.5' : '') + '">' +
        '<td style="white-space:nowrap">' + dot + ' <strong>' + esc((a.prenom || '') + ' ' + (a.nom || '')) + '</strong><br><small style="color:var(--t3)">' + esc(a.matricule || '') + '</small></td>' +
        '<td style="font-family:monospace;font-size:.8rem;color:var(--t2)">' + esc(a.iban || '—') + '</td>' +
        '<td>' + (sessionsHtml || '<span style="color:var(--t3)">—</span>') + '</td>' +
        '<td style="text-align:center"><strong>' + fmtSec(sec) + '</strong>' + (entry.ongoing ? ' <span style="color:var(--gold);font-size:.75rem">+en cours</span>' : '') + '</td>' +
        '<td style="text-align:center;color:var(--gold);font-weight:700">' + fmtMoney(sal) + '</td>' +
        '<td style="text-align:center"><input type="number" min="0" step="1" value="' + prime + '" onchange="setPrimeHisto(\'' + primeKey + '\',this.value)" style="width:92px;background:var(--bg2);color:var(--t0);border:1px solid var(--border0);border-radius:6px;padding:5px 7px;text-align:right"></td>' +
        '<td style="text-align:center;color:var(--green,#2ecc71);font-weight:700">' + fmtMoney(totalAgent) + '</td>' +
        '<td style="text-align:center"><input type="checkbox"' + (isPaid ? ' checked' : '') + ' onchange="togglePaidHisto(\'' + paidKey + '\',this)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--green,#2ecc71)"></td>' +
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
        '<div class="table-wrap"><table>' +
          '<thead><tr><th>AGENT</th><th>IBAN</th><th>PRISE - FIN</th><th style="text-align:center">DUREE</th><th style="text-align:center">SALAIRE</th><th style="text-align:center">PRIME</th><th style="text-align:center">TOTAL</th><th style="text-align:center">PAYE</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
  }).join('');

  setContent(
    '<div class="flex-between mb-20"><div><h1 style="font-size:1.4rem">Historique pointages</h1>' +
    '<p class="text-muted">' + weekKeys.length + ' semaine' + (weekKeys.length > 1 ? 's' : '') + ' enregistrée' + (weekKeys.length > 1 ? 's' : '') + '</p></div>' +
    '<button class="btn btn-ghost btn-sm" onclick="navigate(\'pointeuse\')">← Retour</button></div>' +
    '<div>' + accordionHtml + '</div>'
  );
}

function togglePaidHisto(key, cb) {
  if (cb.checked) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
  var row = cb.closest('tr');
  if (row) row.style.opacity = cb.checked ? '.5' : '';
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
