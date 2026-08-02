// Advanced Discord ticketing admin page.
// Loaded after app.js so it overrides the older localStorage-only ticket screen.
(function() {
  if (typeof DB === 'undefined') return;

  Object.assign(DB, {
    async getTicketPanels() {
      var { data, error } = await getDb().from('ticket_panels').select('*').order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    async createTicketPanel(data) {
      data.updated_at = new Date().toISOString();
      return getDb().from('ticket_panels').insert(data).select().single();
    },
    async updateTicketPanel(id, data) {
      data.updated_at = new Date().toISOString();
      return getDb().from('ticket_panels').update(data).eq('id', id).select().single();
    },
    async deleteTicketPanel(id) {
      return getDb().from('ticket_panels').delete().eq('id', id);
    },
    async getTicketOptions(panelId) {
      var { data, error } = await getDb().from('ticket_options').select('*').eq('panel_id', panelId).order('position');
      if (error) throw error;
      return data || [];
    },
    async createTicketOption(data) {
      data.updated_at = new Date().toISOString();
      return getDb().from('ticket_options').insert(data).select().single();
    },
    async updateTicketOption(id, data) {
      data.updated_at = new Date().toISOString();
      return getDb().from('ticket_options').update(data).eq('id', id).select().single();
    },
    async deleteTicketOption(id) {
      return getDb().from('ticket_options').delete().eq('id', id);
    },
    async getTicketTickets(panelId) {
      var q = getDb().from('ticket_tickets').select('*').order('opened_at', { ascending: false }).limit(25);
      if (panelId) q = q.eq('panel_id', panelId);
      var { data, error } = await q;
      if (error) throw error;
      return data || [];
    }
  });

  var panels = [];
  var options = [];
  var tickets = [];
  var selectedPanelId = null;

  function h(v) { return esc(v == null ? '' : String(v)); }
  function a(v) { return h(v).replace(/"/g, '&quot;'); }
  function idsToText(v) { return Array.isArray(v) ? v.join(', ') : String(v || ''); }
  function textToIds(v) {
    return String(v || '').split(/[\s,;]+/).map(function(x) { return x.replace(/\D/g, ''); }).filter(Boolean);
  }
  function slug(v) {
    return String(v || 'ticket').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ticket';
  }
  function sqlHint() {
    return 'Ouvre C:\\Users\\louis\\Desktop\\sasp-intranet\\ticket-system.sql, copie tout, puis colle dans Supabase Sud > SQL Editor > Run.';
  }
  function selectedPanel() {
    return panels.find(function(p) { return p.id === selectedPanelId; }) || panels[0] || null;
  }

  function css() {
    return '<style>' +
      '.ticket-v2{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;min-height:calc(100vh - 110px)}.ticket-v2 *{box-sizing:border-box}' +
      '.tt2-card{background:linear-gradient(180deg,rgba(15,26,42,.94),rgba(7,13,22,.96));border:1px solid rgba(88,143,202,.22);border-radius:8px;box-shadow:0 18px 50px rgba(0,0,0,.22);overflow:hidden}' +
      '.tt2-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(88,143,202,.18)}' +
      '.tt2-kicker{font-size:10px;letter-spacing:.34em;color:#d4af37;text-transform:uppercase;font-weight:800}.tt2-title{font-size:20px;font-weight:900;margin-top:4px;color:#fff}.tt2-sub{font-size:13px;color:#8fb7e8;margin-top:3px}' +
      '.tt2-list{padding:10px;display:grid;gap:8px}.tt2-panel{width:100%;text-align:left;background:#07111e;border:1px solid rgba(88,143,202,.2);color:#d7e9ff;border-radius:8px;padding:12px;cursor:pointer;transition:.15s ease}.tt2-panel:hover,.tt2-panel.active{border-color:#d4af37;background:rgba(212,175,55,.1);transform:translateY(-1px)}.tt2-panel strong{display:block;font-size:14px;color:#fff}.tt2-panel span{font-size:12px;color:#8fb7e8}' +
      '.tt2-toolbar{display:flex;gap:8px;flex-wrap:wrap}.tt2-main{display:grid;gap:16px}.tt2-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px}.tt2-wide{grid-column:1/-1}' +
      '.tt2-field label{display:block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#7898bb;font-weight:800;margin-bottom:6px}.tt2-field input,.tt2-field textarea,.tt2-field select{width:100%;background:#050c15;border:1px solid rgba(88,143,202,.32);border-radius:7px;color:#eef6ff;padding:10px 11px;font-size:13px;outline:none}.tt2-field textarea{resize:vertical;min-height:96px}.tt2-field input:focus,.tt2-field textarea:focus,.tt2-field select:focus{border-color:#d4af37;box-shadow:0 0 0 3px rgba(212,175,55,.1)}' +
      '.tt2-btn{border:1px solid rgba(88,143,202,.35);background:#07111e;color:#bfe0ff;border-radius:7px;padding:9px 12px;font-weight:800;font-size:12px;cursor:pointer;transition:.15s ease}.tt2-btn:hover{border-color:#d4af37;color:#fff}.tt2-btn.primary{background:#d4af37;border-color:#d4af37;color:#05070b}.tt2-btn.blue{background:#0b4fa3;border-color:#327fdf;color:white}.tt2-btn.red{background:#321016;border-color:#ba3a4b;color:#ff9da8}.tt2-btn.green{background:#0f3d2a;border-color:#209b63;color:#92f0bd}' +
      '.tt2-options{display:grid;gap:10px;padding:16px}.tt2-option{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:12px;align-items:center;background:#07111e;border:1px solid rgba(88,143,202,.22);border-radius:8px;padding:12px}.tt2-emoji{width:42px;height:42px;border-radius:10px;display:grid;place-items:center;background:rgba(212,175,55,.12);border:1px solid rgba(212,175,55,.35);font-size:22px}.tt2-option strong{color:#fff}.tt2-option p{margin:4px 0 0;color:#8fb7e8;font-size:12px;line-height:1.35}.tt2-meta{display:flex;gap:6px;flex-wrap:wrap;margin-top:7px}.tt2-pill{font-size:10px;color:#d4af37;border:1px solid rgba(212,175,55,.3);border-radius:99px;padding:3px 7px;background:rgba(212,175,55,.08)}' +
      '.tt2-preview{padding:16px;display:grid;gap:12px}.discord-preview{background:#313338;border-left:4px solid #d4af37;border-radius:4px;padding:14px;max-width:620px;color:#f2f3f5}.discord-preview h3{margin:0 0 8px;font-size:17px}.discord-preview p{white-space:pre-line;margin:0;color:#d6d8dc;line-height:1.45}.discord-select{margin-top:12px;background:#2b2d31;border:1px solid #3f4147;border-radius:5px;padding:12px;color:#b5bac1}.tt2-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.tt2-stat{background:#07111e;border:1px solid rgba(88,143,202,.2);border-radius:8px;padding:12px}.tt2-stat strong{display:block;font-size:22px;color:#d4af37}.tt2-stat span{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#8fb7e8}' +
      '.tt2-sql{padding:18px}.tt2-sql pre{white-space:pre-wrap;background:#050c15;border:1px solid rgba(212,175,55,.3);border-radius:8px;padding:14px;color:#d7e9ff}' +
      '@media(max-width:1000px){.ticket-v2{grid-template-columns:1fr}.tt2-grid{grid-template-columns:1fr}}' +
    '</style>';
  }

  async function load() {
    panels = await DB.getTicketPanels();
    if (!selectedPanelId && panels[0]) selectedPanelId = panels[0].id;
    var p = selectedPanel();
    options = p ? await DB.getTicketOptions(p.id) : [];
    tickets = p ? await DB.getTicketTickets(p.id).catch(function(){ return []; }) : [];
  }

  window.renderTicketing = async function renderTicketing() {
    if (!isAdmin()) { toast('Acces reserve aux administrateurs.', 'error'); return; }
    try { await load(); }
    catch(e) {
      setContent(css() + '<div class="tt2-card tt2-sql"><div class="tt2-kicker">Initialisation ticketing</div><h2>Tables tickets manquantes</h2><p class="card-sub">Execute le SQL avant d utiliser le panneau avance.</p><pre>' + h(sqlHint()) + '</pre><div class="tt2-toolbar"><button class="tt2-btn primary" onclick="copyTicketSqlHint()">Copier</button><button class="tt2-btn" onclick="renderTicketing()">Reessayer</button></div></div>');
      return;
    }
    var p = selectedPanel();
    var panelButtons = panels.map(function(panel) {
      return '<button class="tt2-panel ' + (p && p.id === panel.id ? 'active' : '') + '" onclick="ticketingSelectPanel(\'' + a(panel.id) + '\')"><strong>' + h(panel.name || 'Panneau tickets') + '</strong><span>' + h(panel.channel_id ? '#' + panel.channel_id : 'Salon non defini') + '</span></button>';
    }).join('') || '<div class="card-sub">Aucun panneau.</div>';
    setContent(css() +
      '<div class="ticket-v2"><aside class="tt2-card"><div class="tt2-head"><div><div class="tt2-kicker">Ticketing</div><div class="tt2-title">Panneaux</div><div class="tt2-sub">Configuration type Ticket Tool</div></div></div><div class="tt2-list">' + panelButtons + '</div><div style="padding:0 10px 12px"><button class="tt2-btn primary" style="width:100%" onclick="ticketingCreatePanel()">+ Nouveau panneau</button></div></aside><main class="tt2-main">' + (p ? panelEditor(p) : emptyState()) + '</main></div>');
  };

  function emptyState() {
    return '<section class="tt2-card tt2-sql"><h2>Aucun panneau selectionne</h2><p class="card-sub">Cree un panneau pour commencer.</p></section>';
  }

  function field(label, id, value, placeholder) {
    return '<div class="tt2-field"><label>' + h(label) + '</label><input id="' + id + '" value="' + a(value) + '" placeholder="' + a(placeholder || '') + '"></div>';
  }
  function area(label, id, value, placeholder, wide) {
    return '<div class="tt2-field ' + (wide ? 'tt2-wide' : '') + '"><label>' + h(label) + '</label><textarea id="' + id + '" placeholder="' + a(placeholder || '') + '">' + h(value || '') + '</textarea></div>';
  }

  function panelEditor(p) {
    return '<section class="tt2-card"><div class="tt2-head"><div><div class="tt2-kicker">Panel</div><div class="tt2-title">' + h(p.name) + '</div><div class="tt2-sub">Message Discord, salon, logs et comportement</div></div><div class="tt2-toolbar"><button class="tt2-btn green" onclick="ticketingSavePanel()">Sauvegarder</button><button class="tt2-btn blue" onclick="ticketingPublishPanel()">Envoyer sur Discord</button><button class="tt2-btn" onclick="installTicketCommand()">Installer /ticket-panel</button><button class="tt2-btn red" onclick="ticketingDeletePanel()">Supprimer</button></div></div>' +
      '<div class="tt2-grid">' +
        field('Nom du panneau', 'ttPanelName', p.name, 'Ticket recrutement') +
        field('Serveur Discord', 'ttGuildId', p.guild_id || GUILD_ID, '1500975724750704661') +
        field('Salon du panneau', 'ttChannelId', p.channel_id, '1533451858209931477') +
        field('Categorie par defaut', 'ttDefaultCategoryId', p.default_category_id, '1501323835562000384') +
        field('Salon logs', 'ttLogChannelId', p.log_channel_id, 'ID salon logs') +
        field('Salon transcripts', 'ttTranscriptChannelId', p.transcript_channel_id, 'ID salon transcripts') +
        field('Titre Discord', 'ttTitle', p.title, 'Contact Division / Unite') +
        field('Placeholder menu', 'ttPlaceholder', p.placeholder, 'Fais un choix') +
        '<div class="tt2-field"><label>Style composant</label><select id="ttComponentType"><option value="select"' + (p.component_type !== 'buttons' ? ' selected' : '') + '>Menu deroulant</option><option value="buttons"' + (p.component_type === 'buttons' ? ' selected' : '') + '>Boutons</option></select></div>' +
        field('Image URL', 'ttImageUrl', p.image_url, 'https://...') +
        area('Message du panneau', 'ttDescription', p.description, 'Explique le choix et les services.', true) +
        field('Footer', 'ttFooter', p.footer, 'SASP - Ticketing') +
      '</div></section>' +
      '<section class="tt2-card"><div class="tt2-head"><div><div class="tt2-kicker">Options</div><div class="tt2-title">Choix du panel</div><div class="tt2-sub">Chaque option est libre et peut ouvrir dans sa propre categorie.</div></div><div class="tt2-toolbar"><button class="tt2-btn primary" onclick="ticketingOpenOptionModal()">+ Ajouter option</button></div></div><div class="tt2-options">' + optionsHtml() + '</div></section>' +
      '<section class="tt2-card"><div class="tt2-head"><div><div class="tt2-kicker">Apercu</div><div class="tt2-title">Rendu Discord</div></div></div><div class="tt2-preview">' + previewHtml(p) + statsHtml() + '</div></section>';
  }

  function optionsHtml() {
    if (!options.length) return '<div class="card-sub">Aucune option. Ajoute les choix, categories et roles depuis ce panneau.</div>';
    return options.map(function(o) {
      return '<div class="tt2-option"><div class="tt2-emoji">' + h(o.emoji || '🎫') + '</div><div><strong>' + h(o.label) + '</strong><p>' + h(o.description || 'Ouvrir une liaison privee') + '</p><div class="tt2-meta"><span class="tt2-pill">Categorie ' + h(o.category_id || 'defaut') + '</span><span class="tt2-pill">Support ' + ((o.support_role_ids || []).length) + '</span><span class="tt2-pill">' + (o.enabled === false ? 'Desactive' : 'Actif') + '</span></div></div><div class="tt2-toolbar"><button class="tt2-btn" onclick="ticketingOpenOptionModal(\'' + a(o.id) + '\')">Modifier</button><button class="tt2-btn red" onclick="ticketingDeleteOption(\'' + a(o.id) + '\')">Supprimer</button></div></div>';
    }).join('');
  }

  function previewHtml(p) {
    var desc = p.description || 'Selectionnez une entree dans le menu pour ouvrir une liaison privee.';
    if (options.length) desc += '\n\n' + options.map(function(o) { return (o.emoji || '🎫') + ' ' + o.label; }).join('\n');
    return '<div class="discord-preview"><h3>' + h(p.title || 'Contact Division / Unite') + '</h3><p>' + h(desc) + '</p>' + (p.image_url ? '<img src="' + a(p.image_url) + '" style="width:100%;border-radius:6px;margin-top:12px" alt="">' : '') + '<div class="discord-select">' + h(p.placeholder || 'Fais un choix') + '</div></div>';
  }

  function statsHtml() {
    var open = tickets.filter(function(t) { return t.status === 'open' || t.status === 'claimed'; }).length;
    return '<div class="tt2-stats"><div class="tt2-stat"><strong>' + options.length + '</strong><span>Options</span></div><div class="tt2-stat"><strong>' + open + '</strong><span>Tickets ouverts</span></div><div class="tt2-stat"><strong>' + tickets.length + '</strong><span>Historique recent</span></div></div>';
  }

  window.ticketingSelectPanel = async function(id) { selectedPanelId = id; await window.renderTicketing(); };

  window.ticketingCreatePanel = async function() {
    try {
      var res = await DB.createTicketPanel({
        guild_id: GUILD_ID || '1500975724750704661',
        name: 'Contact divisions',
        channel_id: '1533451858209931477',
        default_category_id: '1501323835562000384',
        title: 'Contact Division / Unite',
        description: 'Selectionnez la division ou le service a contacter. Un salon prive sera ouvert automatiquement.',
        image_url: 'https://louiis-hub.github.io/sasp-intranet/assets/sasp-sud-watermark.png',
        footer: 'SASP - Ticketing'
      });
      if (res.error) throw res.error;
      selectedPanelId = res.data.id;
      toast('Panneau cree.', 'success');
      await window.renderTicketing();
    } catch(e) { toast('Erreur panneau: ' + (e.message || e), 'error'); }
  };

  window.ticketingSavePanel = async function() {
    var p = selectedPanel();
    if (!p) return;
    var payload = {
      name: document.getElementById('ttPanelName').value.trim() || 'Panneau tickets',
      guild_id: document.getElementById('ttGuildId').value.replace(/\D/g, '') || GUILD_ID,
      channel_id: document.getElementById('ttChannelId').value.replace(/\D/g, ''),
      default_category_id: document.getElementById('ttDefaultCategoryId').value.replace(/\D/g, ''),
      log_channel_id: document.getElementById('ttLogChannelId').value.replace(/\D/g, ''),
      transcript_channel_id: document.getElementById('ttTranscriptChannelId').value.replace(/\D/g, ''),
      component_type: document.getElementById('ttComponentType').value,
      title: document.getElementById('ttTitle').value.trim() || 'Contact Division / Unite',
      placeholder: document.getElementById('ttPlaceholder').value.trim() || 'Fais un choix',
      image_url: document.getElementById('ttImageUrl').value.trim(),
      description: document.getElementById('ttDescription').value.trim(),
      footer: document.getElementById('ttFooter').value.trim() || 'SASP - Ticketing'
    };
    var res = await DB.updateTicketPanel(p.id, payload);
    if (res.error) { toast(res.error.message, 'error'); return; }
    toast('Panneau sauvegarde.', 'success');
    await window.renderTicketing();
  };

  window.ticketingDeletePanel = async function() {
    var p = selectedPanel();
    if (!p || !confirm('Supprimer ce panneau ticket et ses options ?')) return;
    var res = await DB.deleteTicketPanel(p.id);
    if (res.error) { toast(res.error.message, 'error'); return; }
    selectedPanelId = null;
    toast('Panneau supprime.', 'success');
    await window.renderTicketing();
  };

  window.ticketingOpenOptionModal = function(id) {
    var o = options.find(function(x) { return x.id === id; }) || {};
    openModal({
      eyebrow: 'Ticket option',
      title: o.id ? 'Modifier option' : 'Ajouter option',
      size: 'lg',
      body: '<div class="tt2-grid">' +
        field('Label', 'ttOptLabel', o.label, 'Criminal Investigation Division') +
        field('Emoji', 'ttOptEmoji', o.emoji || '🎫', '🎫') +
        field('Cle interne', 'ttOptKey', o.key, 'cid') +
        field('Categorie Discord', 'ttOptCategory', o.category_id, 'ID categorie') +
        field('Roles support', 'ttOptSupportRoles', idsToText(o.support_role_ids), 'IDs separes par virgule') +
        field('Roles a ping', 'ttOptMentionRoles', idsToText(o.mention_role_ids), 'IDs separes par virgule') +
        field('Format nom salon', 'ttOptChannelFormat', o.channel_name_format || 'ticket-{option}-{user}', 'ticket-{option}-{user}') +
        field('Position', 'ttOptPosition', o.position || 0, '0') +
        area('Description', 'ttOptDescription', o.description, 'Ouvrir une liaison privee avec ce service.', true) +
        area('Message de bienvenue', 'ttOptWelcome', o.welcome_message, 'Expliquez votre demande ici...', true) +
      '</div>',
      footer: '<button class="tt2-btn" onclick="closeModal()">Annuler</button><button class="tt2-btn primary" onclick="ticketingSaveOption(\'' + a(o.id || '') + '\')">Sauvegarder</button>'
    });
  };
  window.ticketingSaveOption = async function(id) {
    var p = selectedPanel();
    if (!p) return;
    var label = document.getElementById('ttOptLabel').value.trim();
    var payload = {
      panel_id: p.id,
      label: label,
      key: document.getElementById('ttOptKey').value.trim() || slug(label),
      emoji: document.getElementById('ttOptEmoji').value.trim() || '🎫',
      category_id: document.getElementById('ttOptCategory').value.replace(/\D/g, ''),
      support_role_ids: textToIds(document.getElementById('ttOptSupportRoles').value),
      mention_role_ids: textToIds(document.getElementById('ttOptMentionRoles').value),
      channel_name_format: document.getElementById('ttOptChannelFormat').value.trim() || 'ticket-{option}-{user}',
      position: parseInt(document.getElementById('ttOptPosition').value, 10) || 0,
      description: document.getElementById('ttOptDescription').value.trim(),
      welcome_message: document.getElementById('ttOptWelcome').value.trim(),
      enabled: true
    };
    if (!payload.label) { toast('Label obligatoire.', 'error'); return; }
    var res = id ? await DB.updateTicketOption(id, payload) : await DB.createTicketOption(payload);
    if (res.error) { toast(res.error.message, 'error'); return; }
    closeModal();
    toast('Option sauvegardee.', 'success');
    await window.renderTicketing();
  };

  window.ticketingDeleteOption = async function(id) {
    if (!confirm('Supprimer cette option ticket ?')) return;
    var res = await DB.deleteTicketOption(id);
    if (res.error) { toast(res.error.message, 'error'); return; }
    toast('Option supprimee.', 'success');
    await window.renderTicketing();
  };

  window.ticketingPublishPanel = async function() {
    var p = selectedPanel();
    if (!p) return;
    try {
      await window.ticketingSavePanel();
      var current = selectedPanel() || p;
      toast('Envoi du panneau Discord...', 'info');
      var r = await fetch(WORKER_BASE + '/admin/tickets/publish-panel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-log-token': LOG_TOKEN },
        body: JSON.stringify({ panel_id: current.id, guild_id: current.guild_id || GUILD_ID })
      });
      var data = await r.json().catch(function(){ return {}; });
      if (!r.ok || data.ok === false) throw new Error(data.error || 'Envoi impossible');
      toast('Panneau envoye dans Discord.', 'success');
      await window.renderTicketing();
    } catch(e) { toast('Erreur envoi: ' + (e.message || e), 'error'); }
  };

  window.copyTicketSqlHint = function() {
    fallbackCopyText(sqlHint(), function() { toast('Instructions copiees.', 'success'); });
  };
})();
